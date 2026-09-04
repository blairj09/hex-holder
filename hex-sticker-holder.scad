// =====================================================================
// Hex Sticker Holder — parametric OpenSCAD version
//
// Reverse-engineered from hexstickerholder.blend (Body + Lid meshes).
// The body is a hex canister with a hexagonal internal void that holds
// a stack of hex stickers; the lid is a flanged cap with a hex plug
// that friction-fits into the void's opening.
//
// The whole object is defined by exactly two numbers — see
// "Core Dimensions" below: the void's hex width and its depth. Every
// other dimension (wall thickness, floor, lid, honeycomb texture,
// snap-fit bead/groove) is derived from those two in the same fixed
// proportions as the reference design, so changing either one keeps
// the holder correctly proportioned and printable instead of requiring
// a dozen other constants to be retuned by hand.
//
// NOTE: the decorative honeycomb texture embossed on the body's
// outer walls has been reproduced parametrically below. The two logo
// curves ("Blue Logo"/"Orange Logo") in the original Blender file are
// still left out of this structural/parametric model — they could be
// added later (e.g. with text()/import() of an SVG logo) without
// touching the parametric core below.
//
// All dimensions in millimetres.
// =====================================================================

/* [Core Dimensions] */
// These are the only two numbers you should need to change.

// Flat-to-flat width of the hexagonal sticker void — "the hexagon"
// the whole holder is built around. The original Blender design
// measured 43.3mm; it was grown twice since (a total of +2mm) because
// the fit kept coming out too tight, landing here at 45.3mm.
void_flat_to_flat = 46;

// Depth of the sticker void, floor to rim — this is what sets the
// holder's overall height. Walls and the honeycomb reveal lengthen or
// shorten to match; the floor stays proportionally thin (see
// floor_thickness below) rather than growing with it.
void_depth = 30.0;

// Flat-to-flat size of each honeycomb cell in the exterior tessellation
// — independent of the void's size, so the texture can be made finer
// or coarser without touching the sticker chamber. The ridge left
// between adjacent cells (texture_cell_gap, under "Hidden") is held at
// a fixed 0.8mm no matter what this is set to, so shrinking the cells
// never makes that separator too thin to print.
texture_cell_flat2flat = 3.9;

/* [Texture style] */
// false = engraved — the honeycomb is cut into the outer wall (the
// original look). true = embossed — the honeycomb stands proud of the
// wall instead, raised outward by the same texture_depth.
texture_emboss = false;

/* [What to render] */
part = "both"; // [both, body, lid, both_exploded]
explode_gap = 12;

$fn = 96;

/* [Hidden] */

// ---------------------------------------------------------------------
// Everything below here is derived from void_flat_to_flat and
// void_depth above, held to the same proportions as the reference
// design. Nothing below is meant to be tuned directly — to change a
// dimension, change one of the two core numbers above and let it flow
// through, or edit the ratio it's built from here.
// ---------------------------------------------------------------------

// Tiny vertical overlap used whenever two prisms are stacked cap-to-cap.
// Without this, touching-but-not-overlapping coincident faces can confuse
// CGAL's boolean engine and leave the parts as separate (non-manifold)
// shells instead of a single fused solid. This is a numerical-robustness
// fudge factor, not a design dimension, so it stays fixed in absolute mm.
eps = 0.02;

// --- shell & floor, as a fraction of the core dimensions ---
wall_thickness       = void_flat_to_flat * (1.5 / 45.3);  // outer wall thickness
body_corner_radius   = void_flat_to_flat * (2.5 / 45.3);  // outer vertical-edge fillet
cavity_corner_radius = void_flat_to_flat * (1.5 / 45.3);  // void corner fillet
floor_thickness      = void_depth * (1.8 / 30.0);         // solid floor under the void

body_flat_to_flat = void_flat_to_flat + 2 * wall_thickness; // outer hex width

// --- void mouth chamfer & internal floor/wall weld bevel, scaled off
// wall_thickness since they're wall-scale features ---
opening_chamfer_h = wall_thickness * (1.0 / 1.5);
opening_chamfer_w = wall_thickness * (0.6 / 1.5);

base_bevel_enable = true;
base_bevel_size   = wall_thickness * (0.8 / 1.5); // internal floor/wall weld fillet

// --- outer honeycomb engraving ---
// texture_cell_flat2flat lives up in "Core Dimensions" now (it's meant
// to be adjusted directly). texture_cell_gap deliberately does NOT
// scale with it — it's held at a fixed absolute thickness so the
// separator between cells stays printable at any cell size. 0.8mm was
// tuned earlier for reliable FDM printing (0.5mm came out too thin to
// show up as a standing wall).
texture_enable   = true;
texture_cell_gap = 0.8;                                  // ridge left between adjacent cells (mm), fixed
texture_depth    = wall_thickness * (0.5 / 1.5);          // engraving depth
texture_margin_top      = void_depth * (2.0 / 30.0);             // untextured band below the rim
texture_margin_side     = void_flat_to_flat * (2.2 / 45.3);      // untextured band near each corner
// (the untextured margin above the floor line is derived further down,
// so it always matches the blank band the lid's flange adds at the top —
// see texture_margin_bottom under "Derived geometry")

// --- lid ---
lid_flange_thickness = floor_thickness * (1.6 / 1.8);   // thickness of the wide cap flange
lid_plug_clearance   = wall_thickness * (0.12 / 1.5);    // radial gap kept between the plug and the void wall
lid_plug_height      = void_depth * (6.0 / 30.0);        // length of the plug that inserts into the void
lid_plug_tip_chamfer = lid_plug_height * (0.6 / 6.0);    // lead-in taper at the plug tip, for easy insertion

// --- lid snap retention ---
// A bead on the plug (the "notch") seats into a matching groove cut into
// the void wall (the "groove") once the lid is pressed all the way home,
// so the lid resists being pulled straight back off instead of relying
// on plain friction along the whole plug. Both are shaped as a lens
// (tapered in from both sides, widest in the middle) so they cam past
// each other smoothly instead of catching on a sharp step.
lid_retention_bead       = wall_thickness * (0.3 / 1.5);            // radial oversize of the bead vs. the plug
lid_retention_bead_pos   = 0.55;                                     // bead position along the plug, 0 = base (flange) .. 1 = tip
lid_retention_bead_width = lid_plug_height * (1.4 / 6.0);            // height of the bead band
groove_clearance         = wall_thickness * (0.15 / 1.5);            // extra room the groove gives the bead once seated
groove_extra_height      = lid_retention_bead_width * (0.3 / 1.4);   // extra vertical play in the groove beyond the bead's own height

// ---------------------------------------------------------------------
// Derived geometry — regular-hexagon math (flat-to-flat <-> circumradius)
// ---------------------------------------------------------------------
function hex_circumradius(flat_to_flat) = flat_to_flat / sqrt(3);
function hex_apothem(flat_to_flat)      = flat_to_flat / 2;

body_apothem   = hex_apothem(body_flat_to_flat);
body_height    = floor_thickness + void_depth; // walls grow/shrink with void_depth; floor stays fixed
cavity_apothem = hex_apothem(void_flat_to_flat);

lid_flange_flat_to_flat = body_flat_to_flat;
plug_flat_to_flat       = void_flat_to_flat - 2 * lid_plug_clearance;
plug_apothem            = hex_apothem(plug_flat_to_flat);

// When the lid is seated, its flange sits on the body's rim and reads as
// a blank (untextured) band continuing up from the top of the wall — on
// top of the body's own texture_margin_top. To make the assembled piece
// look symmetric top-to-bottom, the blank band above the floor mirrors
// that same total height instead of using an independent number.
texture_margin_bottom = texture_margin_top + lid_flange_thickness;

echo(str("Wall thickness: ", wall_thickness, " mm"));
if (wall_thickness < 0.8)
    echo(str("*** WARNING: wall thickness is only ", wall_thickness,
              "mm — increase void_flat_to_flat ***"));

// Only engraving removes material from the wall — embossing adds
// material on top of it, so there's nothing to thin out in that mode.
remaining_under_texture = wall_thickness - ((texture_enable && !texture_emboss) ? texture_depth : 0);
if (texture_enable && !texture_emboss) {
    echo(str("Wall thickness under the honeycomb cells: ", remaining_under_texture, " mm"));
    if (remaining_under_texture < 0.6)
        echo(str("*** WARNING: only ", remaining_under_texture,
                  "mm of material left under each engraved cell — increase void_flat_to_flat ***"));
}

base_bevel_h = base_bevel_enable ? base_bevel_size : 0;
if (base_bevel_h > 0 && base_bevel_h >= cavity_apothem)
    echo(str("*** WARNING: base_bevel_size (", base_bevel_h,
              "mm) is too large for the void's apothem — it would pinch the pocket shut. ***"));
if (base_bevel_h > 0 && base_bevel_h > void_depth * 0.5)
    echo(str("*** WARNING: base_bevel_size (", base_bevel_h,
              "mm) is large relative to void_depth. ***"));

cut_cell_f2f = texture_cell_flat2flat - texture_cell_gap;
if (texture_enable && cut_cell_f2f < 1.0)
    echo(str("*** WARNING: texture_cell_flat2flat (", texture_cell_flat2flat,
              "mm) is too small for the fixed ", texture_cell_gap,
              "mm gap — each cut cell would be only ", cut_cell_f2f,
              "mm wide. Increase texture_cell_flat2flat. ***"));

// Snap-retention geometry, shared between the lid's bead and the body's
// groove so the two stay lined up no matter what void_flat_to_flat /
// void_depth are set to.
plug_straight_h = lid_plug_height - lid_plug_tip_chamfer;
bead_band_h     = lid_retention_bead_width;
bead_center_z   = lid_retention_bead_pos * plug_straight_h; // measured from the plug's base (= the rim, once assembled)
bead_bottom_z   = bead_center_z - bead_band_h / 2;

groove_f2f      = plug_flat_to_flat + 2 * (lid_retention_bead + groove_clearance);
groove_apothem  = hex_apothem(groove_f2f);
groove_grow     = groove_apothem - cavity_apothem; // how much wider the groove cut is than the plain void
groove_band_h   = bead_band_h + groove_extra_height;
groove_wall_min = body_apothem - groove_apothem;

if (lid_retention_bead > 0 && (bead_bottom_z < 0 || bead_bottom_z + bead_band_h > plug_straight_h))
    echo(str("*** WARNING: the retention bead doesn't fit within the plug ***"));

if (lid_retention_bead > 0)
    echo(str("Wall thickness at the retention groove: ", groove_wall_min, " mm"));
if (lid_retention_bead > 0 && groove_wall_min < 0.5)
    echo(str("*** WARNING: only ", groove_wall_min,
              "mm of material left at the retention groove ***"));

// ---------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------

// A regular hexagon, pointy-top (points at +Y/-Y, flats at +X/-X),
// matching the orientation of the original model. corner_r rounds the
// convex corners while keeping the flat-to-flat width unchanged.
module hex2d(flat_to_flat, corner_r = 0) {
    r = hex_circumradius(flat_to_flat);
    if (corner_r > 0) {
        offset(r = corner_r) offset(delta = -corner_r) rotate(30) circle(r = r, $fn = 6);
    } else {
        rotate(30) circle(r = r, $fn = 6);
    }
}

module hex_prism(flat_to_flat, height, corner_r = 0) {
    linear_extrude(height = height, convexity = 6)
        hex2d(flat_to_flat, corner_r);
}

// A hex prism that linearly tapers from flat_to_flat at the bottom to
// flat_to_flat + 2*grow at the top — used for lead-in chamfers.
module hex_prism_tapered(flat_to_flat, height, grow, corner_r = 0) {
    a0 = hex_apothem(flat_to_flat);
    scale_factor = (a0 + grow) / a0;
    linear_extrude(height = height, scale = scale_factor, convexity = 6)
        hex2d(flat_to_flat, corner_r);
}

// ---------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------
module cavity_cutter() {
    straight_h = body_height - floor_thickness - opening_chamfer_h - base_bevel_h;
    union() {
        // base bevel: the cutter starts undersized right at the floor line
        // and tapers back out to the full void size over base_bevel_h —
        // the "missing" material it leaves behind is the reinforcing
        // gusset between the floor and the wall.
        if (base_bevel_h > 0)
            translate([0, 0, floor_thickness])
                hex_prism_tapered(void_flat_to_flat - 2 * base_bevel_h, base_bevel_h + eps,
                                   base_bevel_h, cavity_corner_radius);
        // straight walled pocket, overlapped down into the bevel (or the
        // floor line directly, if the bevel is disabled) so they fuse
        translate([0, 0, floor_thickness + base_bevel_h - eps])
            hex_prism(void_flat_to_flat, straight_h + eps, cavity_corner_radius);
        // flared lead-in at the mouth (slightly oversized on top so it
        // cleanly pokes through the outer shell), overlapped down into
        // the straight section so the two pieces truly fuse
        translate([0, 0, floor_thickness + base_bevel_h + straight_h - eps])
            hex_prism_tapered(void_flat_to_flat, opening_chamfer_h + 0.5 + eps,
                               opening_chamfer_w, cavity_corner_radius);
        // retention groove: a lens-shaped local widening of the void
        // wall, positioned to line up with the lid's bead once the lid is
        // fully seated — see retention_groove_cutter() below
        retention_groove_cutter();
    }
}

// Cuts the groove that the lid's retention bead snaps into. Shaped as a
// lens (tapering out from the plain void size to groove_apothem and
// back), mirroring the bead's own profile, and positioned the same
// distance below the rim as the bead sits below the plug's base — so
// the two align regardless of how the plug/bead parameters are tuned.
module retention_groove_cutter() {
    if (lid_retention_bead > 0) {
        half_h   = groove_band_h / 2;
        center_z = body_height - bead_center_z;
        union() {
            translate([0, 0, center_z - half_h - eps])
                hex_prism_tapered(void_flat_to_flat, half_h + eps,
                                   groove_grow, cavity_corner_radius);
            translate([0, 0, center_z - eps])
                hex_prism_tapered(groove_f2f, half_h + eps,
                                   -groove_grow, cavity_corner_radius);
        }
    }
}

// A single small hex feature, extruded along +X (from x=0 to x=depth)
// and centered on the YZ plane — one honeycomb cell, ready to be
// translated onto a face and rotated with it. Oriented "pointy-top":
// the long point-to-point diagonal runs vertically (body Z), flat-to-
// flat runs horizontally (body Y) — the -30° undoes hex2d's own +30°
// rotation, which was tuned for the body/lid's point-up-in-3D
// convention, not this feature's axis remapping. Used both as a cutter
// (engraved mode) and as an add-on bump (embossed mode) — which one
// just depends on whether the caller union()s or difference()s it in,
// and where along X it's placed.
module small_hex_feature(flat_to_flat, depth) {
    rotate([0, 90, 0])
        linear_extrude(height = depth, convexity = 4)
            rotate(-30)
                hex2d(flat_to_flat);
}

// Tiles small hex cells (pointy-top, brick-offset rows) across one flat
// face of the body, staying clear of the margins given, and places each
// cell either recessed into the +X face (engraved) or standing proud of
// it (embossed) depending on the global texture_emboss flag. face_width
// is the flat side length of the outer hex (the face runs the full
// body_height vertically).
module honeycomb_face_feature(face_width, face_height, cell_f2f, gap, depth,
                               margin_top, margin_bottom, margin_side) {
    R            = hex_circumradius(cell_f2f); // cell half-height (center to point)
    cell_apothem = hex_apothem(cell_f2f);      // cell half-width (center to flat side)
    col_spacing  = cell_f2f;                   // horizontal spacing between columns
    row_spacing  = 1.5 * R;                    // vertical spacing between rows
    cut_f2f      = cell_f2f - gap;

    avail_w = face_width  - 2 * margin_side;
    avail_h = face_height - margin_top - margin_bottom;
    half_w  = avail_w / 2;

    // Only count rows whose cells fit *entirely* inside the available
    // strip — using each cell's own point-to-point half-height, not just
    // its center — then center that whole block of rows within the
    // strip so the leftover space splits evenly between margin_top and
    // margin_bottom instead of landing unpredictably on one side.
    n_rows    = (avail_h >= 2 * R) ? floor((avail_h - 2 * R) / row_spacing) + 1 : 0;
    row_block = (n_rows - 1) * row_spacing + 2 * R;
    z0        = margin_bottom + (avail_h - row_block) / 2 + R;

    // Engraved: start "depth" inside the surface and cut outward past it
    // (the +1 overshoot pokes cleanly through the outer shell). Embossed:
    // start just inside the surface (eps overlap, to fuse cleanly with
    // the shell) and build outward by "depth", standing proud of it.
    x0          = texture_emboss ? (body_apothem - eps) : (body_apothem - depth);
    feature_len = texture_emboss ? (depth + eps) : (depth + 1);

    for (i = [0 : n_rows - 1]) {
        z = z0 + i * row_spacing;
        y_off = (i % 2 == 1) ? col_spacing / 2 : 0;
        max_j = ceil(half_w / col_spacing) + 2;
        for (j = [-max_j : max_j]) {
            y = j * col_spacing + y_off;
            // only keep columns whose cell fits entirely within the
            // available width, same full-cell-fit logic as the rows
            if (y - cell_apothem >= -half_w && y + cell_apothem <= half_w)
                translate([x0, y, z])
                    small_hex_feature(cut_f2f, feature_len);
        }
    }
}

// Honeycomb texture on all six outer faces — engraved cuts or embossed
// bumps, depending on texture_emboss.
module outer_texture_feature() {
    face_width = hex_circumradius(body_flat_to_flat); // regular-hexagon side length == circumradius
    for (k = [0 : 5])
        rotate([0, 0, 60 * k])
            honeycomb_face_feature(face_width, body_height, texture_cell_flat2flat,
                                    texture_cell_gap, texture_depth,
                                    texture_margin_top, texture_margin_bottom, texture_margin_side);
}

module body() {
    difference() {
        union() {
            hex_prism(body_flat_to_flat, body_height, body_corner_radius);
            // embossed: bumps are added to the shell before the void is
            // cut, so they don't get clipped by the cavity subtraction
            if (texture_enable && texture_emboss) outer_texture_feature();
        }
        union() {
            cavity_cutter();
            // engraved: cells are cut out of the shell, same pass as the void
            if (texture_enable && !texture_emboss) outer_texture_feature();
        }
    }
}

// ---------------------------------------------------------------------
// Lid
// ---------------------------------------------------------------------
module lid_plug() {
    union() {
        // main plug shaft
        hex_prism(plug_flat_to_flat, plug_straight_h + eps, cavity_corner_radius);

        // retention bead — a lens-shaped ridge (tapering out from the
        // plug's own size and back) so it cams smoothly past the void
        // wall going both in and out, then relaxes into the matching
        // groove once it's seated
        if (lid_retention_bead > 0 && bead_bottom_z >= 0 && bead_bottom_z + bead_band_h <= plug_straight_h) {
            half_bead_h = bead_band_h / 2;
            translate([0, 0, bead_bottom_z - eps])
                hex_prism_tapered(plug_flat_to_flat, half_bead_h + eps,
                                   lid_retention_bead, cavity_corner_radius);
            translate([0, 0, bead_bottom_z + half_bead_h - eps])
                hex_prism_tapered(plug_flat_to_flat + 2 * lid_retention_bead, half_bead_h + eps,
                                   -lid_retention_bead, cavity_corner_radius);
        }

        // tapered tip so the plug leads into the void easily, overlapped
        // down into the shaft so the two pieces truly fuse
        translate([0, 0, plug_straight_h - eps])
            hex_prism_tapered(plug_flat_to_flat, lid_plug_tip_chamfer + eps,
                               -lid_plug_tip_chamfer, cavity_corner_radius);
    }
}

module lid() {
    union() {
        // wide flange that rests on the body's rim
        hex_prism(lid_flange_flat_to_flat, lid_flange_thickness + eps, body_corner_radius);
        // plug that presses down into the void, overlapped up into the
        // flange so the two pieces truly fuse into one solid
        translate([0, 0, lid_flange_thickness - eps])
            lid_plug();
    }
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------
if (part == "body") {
    body();
} else if (part == "lid") {
    lid();
} else if (part == "both_exploded") {
    body();
    translate([0, 0, body_height + explode_gap]) lid();
} else {
    // "both" — laid out side-by-side, each in its natural print orientation
    translate([-(body_flat_to_flat/2 + 5), 0, 0]) body();
    translate([ (lid_flange_flat_to_flat/2 + 5), 0, 0]) lid();
}

