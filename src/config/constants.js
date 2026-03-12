export const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]
];
export const SHOW_HAND_MARKERS = true;
export const HAND_OVERLAY_SCALE = 0.88;
export const OVERLAY_MIN_ALPHA = 0.08;
export const OVERLAY_MAX_ALPHA = 0.4;
export const OVERLAY_MOTION_GAIN = 7.8;
export const OVERLAY_SIDE_PROFILE_ALPHA = 0.46;
export const OVERLAY_MATCH_MAX_DIST = 0.24;
export const OVERLAY_TRAIL_LENGTH = 7;
export const OVERLAY_TRAIL_MIN_STEP = 0.0032;
export const PALM_CENTER_INDEXES = [0, 5, 9, 13, 17];
export const SPAWN_COOLDOWN_MS = 2000;
export const FIST_DELETE_COOLDOWN_MS = 420;
export const FIST_HOLD_MS = 180;
export const OPERATION_COOLDOWN_MS = 900;
export const PLACEMENT_PULSE_BASE = 8;
export const PLACEMENT_PULSE_GAIN = 7;
export const PLACEMENT_PULSE_TRIGGER_RADIUS = 12.2;
export const SELECTION_RING_BASE_RADIUS = 0.31;
export const VIEW_DRAG_GROUND_LOCK_THRESHOLD = 0.72;
export const LINE_DEPTH_RAY_GAIN = 2.9;
export const LINE_DEPTH_MAX_OFFSET = 9;
export const LINE_DEPTH_DEADZONE = 0.005;
export const TRANSFORM_SELECT_BUFFER = 0.95;
export const TRANSFORM_MIDPOINT_RADIUS_FACTOR = 1.08;
export const TRANSFORM_OPPOSITION_DOT_MAX = 0.72;
export const MIN_TRANSFORM_SPAN = 0.3;
export const MIN_MESH_SCALE = 0.35;
export const MAX_MESH_SCALE = 4.5;
export const TRANSFORM_LOCK_MS = 90;
export const TRANSFORM_HAND_RETURN_MS = 850;
export const TRANSFORM_SCALE_SMOOTHING = 0.18;
export const TRANSFORM_ROTATION_SMOOTHING = 0.16;
export const PLACEMENT_PREVIEW_OPACITY = 0.28;
export const PLACEMENT_SURFACE_GAP = 0.012;
export const PLACEMENT_COLLISION_TOLERANCE = 0.01;
export const PLACEMENT_NEAR_SNAP_BASE = 0.12;
export const PLACEMENT_NEAR_SNAP_GAIN = 0.18;
export const PLACEMENT_SURFACE_NUDGE_LIMIT = 6;
export const SHAPE_OPTIONS = ["cube", "cuboid", "sphere", "cylinder", "line"];
export const SIGNALS = {
  FIST_DELETE: "fist_delete",
  POINT_ROTATE: "point_rotate",
};
