# Blender ヘッドレス最適化スクリプト
# 使い方 (pipeline.mjs から呼ばれる):
#   blender -b --python optimize.py -- --input raw.glb --output out.glb \
#       --target-tris 4000 --renders ./renders [--size 1.5]
#
# 処理内容:
#   1. GLB をインポートし、全メッシュを1オブジェクトに結合
#   2. クリーンアップ (重複頂点マージ、孤立要素削除、法線再計算)
#   3. 三角形数が目標を超えていれば Decimate で削減
#   4. 正規化: 底面中心を原点に、--size 指定時は最大辺をその長さ(m)にスケール
#   5. GLB (テクスチャ埋め込み) をエクスポート
#   6. 検証用ターンテーブルレンダー 4 枚を出力

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--target-tris", type=int, default=4000)
parser.add_argument("--renders", required=True)
parser.add_argument("--size", type=float, default=None)
args = parser.parse_args(argv)

# --- 空のシーンから開始してインポート ---
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.input)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    print("ERROR: メッシュが見つかりません", file=sys.stderr)
    sys.exit(1)

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active

# 不要なオブジェクト (空ノード等) を削除
for o in list(bpy.context.scene.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)

# --- クリーンアップ ---
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.0001)
bpy.ops.mesh.delete_loose()
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")


def tri_count(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


before = tri_count(obj)

# --- ポリゴン削減 ---
if before > args.target_tris * 1.1:
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = args.target_tris / before
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)

after = tri_count(obj)
print(f"[optimize] tris: {before} -> {after} (target {args.target_tris})")

# --- 正規化: スケールと原点 ---
def world_bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


lo, hi = world_bbox(obj)
dims = hi - lo
max_dim = max(dims.x, dims.y, dims.z)
if args.size and max_dim > 0:
    s = args.size / max_dim
    obj.scale = (obj.scale[0] * s, obj.scale[1] * s, obj.scale[2] * s)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.transform_apply(scale=True)
    lo, hi = world_bbox(obj)

# 底面中心を原点へ (Blender は Z-up。glTF エクスポート時に Y-up へ変換される)
center = (lo + hi) / 2
obj.location.x -= center.x
obj.location.y -= center.y
obj.location.z -= lo.z
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.ops.object.transform_apply(location=True)
lo, hi = world_bbox(obj)
print(f"[optimize] size: {hi.x - lo.x:.2f} x {hi.y - lo.y:.2f} x {hi.z - lo.z:.2f} m")

# --- エクスポート (カメラ・ライト追加前に行う) ---
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=args.output,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,
)
print(f"[optimize] exported: {args.output}")

# --- 検証用ターンテーブルレンダー ---
scene = bpy.context.scene
engines = {
    e.identifier
    for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
}
for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    if candidate in engines:
        scene.render.engine = candidate
        break
scene.render.resolution_x = 512
scene.render.resolution_y = 512

world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (0.85, 0.85, 0.85, 1.0)
    bg.inputs[1].default_value = 1.0

sun_data = bpy.data.lights.new("Sun", "SUN")
sun_data.energy = 3.0
sun = bpy.data.objects.new("Sun", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0.0, math.radians(30))

cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

center = Vector((0.0, 0.0, (hi.z - lo.z) / 2))
radius = max((hi - lo).length / 2, 0.01)
dist = radius / math.tan(cam_data.angle / 2) * 1.3
elev = math.radians(20)

os.makedirs(args.renders, exist_ok=True)
for i, yaw_deg in enumerate((30, 120, 210, 300)):
    yaw = math.radians(yaw_deg)
    cam.location = center + Vector((
        dist * math.cos(yaw) * math.cos(elev),
        dist * math.sin(yaw) * math.cos(elev),
        dist * math.sin(elev),
    ))
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(args.renders, f"view_{i}.png")
    bpy.ops.render.render(write_still=True)

print("[optimize] done")
