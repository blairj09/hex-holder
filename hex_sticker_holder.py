"""Parametric Build123d model of the hex sticker holder.

This is a feature-for-feature translation of ``hex-sticker-holder.scad``.
The two primary dimensions are ``void_flat_to_flat`` and ``void_depth``;
the other measurements deliberately retain the proportions of the source
design.  Run ``python hex_sticker_holder.py --help`` for export options.

Requires build123d 0.8 or newer.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from math import ceil, cos, degrees, floor, pi, sin, sqrt
from pathlib import Path

from build123d import BuildPart, BuildSketch, Compound, Location, Plane, RegularPolygon, Vector, export_stl, export_step, extrude, fillet, loft, vertices


EPS = 0.02


@dataclass(frozen=True)
class HolderParameters:
    """User-facing dimensions for the holder, all in millimetres."""

    void_flat_to_flat: float = 46.0
    void_depth: float = 30.0
    texture_cell_flat_to_flat: float = 3.9
    texture_emboss: bool = False
    texture_enable: bool = True

    @property
    def wall_thickness(self) -> float:
        return self.void_flat_to_flat * 1.5 / 45.3

    @property
    def body_corner_radius(self) -> float:
        return self.void_flat_to_flat * 2.5 / 45.3

    @property
    def cavity_corner_radius(self) -> float:
        return self.void_flat_to_flat * 1.5 / 45.3

    @property
    def floor_thickness(self) -> float:
        return self.void_depth * 1.8 / 30.0

    @property
    def body_flat_to_flat(self) -> float:
        return self.void_flat_to_flat + 2 * self.wall_thickness

    @property
    def body_height(self) -> float:
        return self.floor_thickness + self.void_depth

    @property
    def opening_chamfer_height(self) -> float:
        return self.wall_thickness

    @property
    def opening_chamfer_width(self) -> float:
        return self.wall_thickness * 0.6 / 1.5

    @property
    def base_bevel_size(self) -> float:
        return self.wall_thickness * 0.8 / 1.5

    @property
    def texture_depth(self) -> float:
        return self.wall_thickness * 0.5 / 1.5

    @property
    def texture_cell_gap(self) -> float:
        return 0.8

    @property
    def texture_margin_top(self) -> float:
        return self.void_depth * 2.0 / 30.0

    @property
    def texture_margin_side(self) -> float:
        return self.void_flat_to_flat * 2.2 / 45.3

    @property
    def lid_flange_thickness(self) -> float:
        return self.floor_thickness * 1.6 / 1.8

    @property
    def texture_margin_bottom(self) -> float:
        return self.texture_margin_top + self.lid_flange_thickness

    @property
    def lid_plug_clearance(self) -> float:
        return self.wall_thickness * 0.12 / 1.5

    @property
    def lid_plug_height(self) -> float:
        return self.void_depth * 6.0 / 30.0

    @property
    def lid_plug_tip_chamfer(self) -> float:
        return self.lid_plug_height * 0.6 / 6.0

    @property
    def plug_flat_to_flat(self) -> float:
        return self.void_flat_to_flat - 2 * self.lid_plug_clearance

    @property
    def lid_retention_bead(self) -> float:
        return self.wall_thickness * 0.3 / 1.5

    @property
    def lid_retention_bead_width(self) -> float:
        return self.lid_plug_height * 1.4 / 6.0

    @property
    def groove_clearance(self) -> float:
        return self.wall_thickness * 0.15 / 1.5

    @property
    def groove_extra_height(self) -> float:
        return self.lid_retention_bead_width * 0.3 / 1.4


def hex_radius(flat_to_flat: float) -> float:
    """Return the circumradius of a regular hexagon."""

    return flat_to_flat / sqrt(3)


def make_hex_profile(flat_to_flat: float, corner_radius: float = 0.0, plane: Plane = Plane.XY):
    """Create a point-up regular hexagonal sketch on *plane*."""

    with BuildSketch(plane) as profile:
        RegularPolygon(hex_radius(flat_to_flat), 6, rotation=30)
        if corner_radius:
            fillet(vertices(), corner_radius)
    return profile.sketch


def hex_prism(flat_to_flat: float, height: float, corner_radius: float = 0.0):
    """Make a rounded-corner regular-hexagonal prism based at Z=0."""

    with BuildPart() as result:
        extrude(to_extrude=make_hex_profile(flat_to_flat, corner_radius), amount=height)
    return result.part


def tapered_hex_prism(
    flat_to_flat: float, height: float, grow: float, corner_radius: float = 0.0
):
    """Make a hex prism whose flat-to-flat size grows by ``2 * grow``.

    Lofting two profiles is used instead of a taper angle so the supplied
    dimensions stay exact and the behaviour matches OpenSCAD's scaled
    ``linear_extrude``.
    """

    scale = (flat_to_flat + 2 * grow) / flat_to_flat
    with BuildPart() as result:
        bottom = make_hex_profile(flat_to_flat, corner_radius)
        top = make_hex_profile(
            flat_to_flat + 2 * grow,
            corner_radius * scale,
            Plane.XY.offset(height),
        )
        loft(sections=[bottom, top])
    return result.part


def translated(shape, x: float = 0, y: float = 0, z: float = 0):
    """Return *shape* moved without changing the source object."""

    return shape.moved(Location(Vector(x, y, z)))


def fuse_all(shapes):
    """Fuse a non-empty sequence of solids, returning its single shape."""

    result = shapes[0]
    for shape in shapes[1:]:
        result = result.fuse(shape)
    return result


def retention_groove_cutter(p: HolderParameters):
    """Create the lens-shaped receiving groove in the body cavity."""

    straight_height = p.lid_plug_height - p.lid_plug_tip_chamfer
    bead_center = 0.55 * straight_height
    groove_band_height = p.lid_retention_bead_width + p.groove_extra_height
    groove_flat_to_flat = p.plug_flat_to_flat + 2 * (p.lid_retention_bead + p.groove_clearance)
    groove_grow = (groove_flat_to_flat - p.void_flat_to_flat) / 2
    half_height = groove_band_height / 2
    center_z = p.body_height - bead_center

    lower = translated(
        tapered_hex_prism(p.void_flat_to_flat, half_height + EPS, groove_grow, p.cavity_corner_radius),
        z=center_z - half_height - EPS,
    )
    upper = translated(
        tapered_hex_prism(groove_flat_to_flat, half_height + EPS, -groove_grow, p.cavity_corner_radius),
        z=center_z - EPS,
    )
    return lower.fuse(upper)


def cavity_cutter(p: HolderParameters):
    """Create the body void, mouth lead-in, floor weld bevel, and groove."""

    bevel_height = p.base_bevel_size
    straight_height = p.void_depth - p.opening_chamfer_height - bevel_height
    bevel = translated(
        tapered_hex_prism(
            p.void_flat_to_flat - 2 * bevel_height,
            bevel_height + EPS,
            bevel_height,
            p.cavity_corner_radius,
        ),
        z=p.floor_thickness,
    )
    straight = translated(
        hex_prism(p.void_flat_to_flat, straight_height + EPS, p.cavity_corner_radius),
        z=p.floor_thickness + bevel_height - EPS,
    )
    mouth = translated(
        tapered_hex_prism(
            p.void_flat_to_flat,
            p.opening_chamfer_height + 0.5 + EPS,
            p.opening_chamfer_width,
            p.cavity_corner_radius,
        ),
        z=p.floor_thickness + bevel_height + straight_height - EPS,
    )
    return fuse_all([bevel, straight, mouth, retention_groove_cutter(p)])


def honeycomb_features(p: HolderParameters):
    """Create hex cells on all six faces, for cutting or embossing."""

    cell_flat = p.texture_cell_flat_to_flat - p.texture_cell_gap
    if not p.texture_enable or cell_flat <= 0:
        return []

    cell_radius = hex_radius(p.texture_cell_flat_to_flat)
    cell_apothem = p.texture_cell_flat_to_flat / 2
    face_width = hex_radius(p.body_flat_to_flat)
    available_width = face_width - 2 * p.texture_margin_side
    available_height = p.body_height - p.texture_margin_top - p.texture_margin_bottom
    row_count = floor((available_height - 2 * cell_radius) / (1.5 * cell_radius)) + 1 if available_height >= 2 * cell_radius else 0
    block_height = (row_count - 1) * 1.5 * cell_radius + 2 * cell_radius
    z0 = p.texture_margin_bottom + (available_height - block_height) / 2 + cell_radius
    max_column = ceil((available_width / 2) / p.texture_cell_flat_to_flat) + 2

    start_radius = p.body_flat_to_flat / 2 - (EPS if p.texture_emboss else p.texture_depth)
    length = p.texture_depth + EPS if p.texture_emboss else p.texture_depth + 1
    cells = []
    for face in range(6):
        angle = face * pi / 3
        normal = Vector(cos(angle), sin(angle), 0)
        tangent = Vector(-sin(angle), cos(angle), 0)
        for row in range(row_count):
            z = z0 + row * 1.5 * cell_radius
            offset = p.texture_cell_flat_to_flat / 2 if row % 2 else 0
            for column in range(-max_column, max_column + 1):
                horizontal = column * p.texture_cell_flat_to_flat + offset
                if abs(horizontal) + cell_apothem > available_width / 2:
                    continue
                origin = normal * start_radius + tangent * horizontal + Vector(0, 0, z)
                plane = Plane(origin=origin, x_dir=tangent, z_dir=normal)
                with BuildPart() as cell:
                    extrude(to_extrude=make_hex_profile(cell_flat, plane=plane), amount=length)
                cells.append(cell.part)
    return cells


def make_body(p: HolderParameters = HolderParameters()):
    """Build the printable holder body, upright with its floor on Z=0."""

    outer = hex_prism(p.body_flat_to_flat, p.body_height, p.body_corner_radius)
    texture = honeycomb_features(p)
    if p.texture_emboss and texture:
        outer = fuse_all([outer, *texture])
    body = outer.cut(cavity_cutter(p))
    if not p.texture_emboss and texture:
        body = body.cut(fuse_all(texture))
    return body


def make_lid(p: HolderParameters = HolderParameters()):
    """Build the lid upright: flange at Z=0 and plug extending upward."""

    flange = hex_prism(p.body_flat_to_flat, p.lid_flange_thickness + EPS, p.body_corner_radius)
    straight_height = p.lid_plug_height - p.lid_plug_tip_chamfer
    plug = hex_prism(p.plug_flat_to_flat, straight_height + EPS, p.cavity_corner_radius)

    bead_center = 0.55 * straight_height
    bead_bottom = bead_center - p.lid_retention_bead_width / 2
    bead_half = p.lid_retention_bead_width / 2
    bead_lower = translated(
        tapered_hex_prism(p.plug_flat_to_flat, bead_half + EPS, p.lid_retention_bead, p.cavity_corner_radius),
        z=bead_bottom - EPS,
    )
    bead_upper = translated(
        tapered_hex_prism(p.plug_flat_to_flat + 2 * p.lid_retention_bead, bead_half + EPS, -p.lid_retention_bead, p.cavity_corner_radius),
        z=bead_bottom + bead_half - EPS,
    )
    tip = translated(
        tapered_hex_prism(p.plug_flat_to_flat, p.lid_plug_tip_chamfer + EPS, -p.lid_plug_tip_chamfer, p.cavity_corner_radius),
        z=straight_height - EPS,
    )
    plug = fuse_all([plug, bead_lower, bead_upper, tip])
    return flange.fuse(translated(plug, z=p.lid_flange_thickness - EPS))


def export_parts(p: HolderParameters, part: str, output_dir: Path, exploded_gap: float = 12.0):
    """Export selected printable parts as both STEP and STL files."""

    output_dir.mkdir(parents=True, exist_ok=True)
    if part == "body":
        selected = {"body": make_body(p)}
    elif part == "lid":
        selected = {"lid": make_lid(p)}
    elif part == "both_exploded":
        body, lid = make_body(p), make_lid(p)
        selected = {
            "exploded": Compound(
                children=[body, translated(lid, z=p.body_height + exploded_gap)]
            )
        }
    else:
        selected = {"body": make_body(p), "lid": make_lid(p)}

    for name, shape in selected.items():
        export_step(shape, output_dir / f"hex-sticker-holder-{name}.step")
        export_stl(shape, output_dir / f"hex-sticker-holder-{name}.stl")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the parametric Build123d hex sticker holder.")
    parser.add_argument("--void-width", type=float, default=46.0, help="sticker void flat-to-flat width (mm)")
    parser.add_argument("--void-depth", type=float, default=30.0, help="sticker void depth (mm)")
    parser.add_argument("--cell-width", type=float, default=3.9, help="honeycomb cell flat-to-flat width (mm)")
    parser.add_argument("--emboss", action="store_true", help="emboss rather than engrave the honeycomb")
    parser.add_argument("--no-texture", action="store_true", help="omit the honeycomb texture")
    parser.add_argument("--part", choices=("body", "lid", "both", "both_exploded"), default="both")
    parser.add_argument("--output-dir", type=Path, default=Path("build"))
    args = parser.parse_args()
    params = HolderParameters(args.void_width, args.void_depth, args.cell_width, args.emboss, not args.no_texture)
    export_parts(params, args.part, args.output_dir)


if __name__ == "__main__":
    main()
