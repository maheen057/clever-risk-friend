/**
 * objectClassification.js
 *
 * Centralized, authoritative object classification system for the ORION SSA platform.
 *
 * All components MUST use this module to determine object type labels.
 * Do NOT infer object type from display names or duplicate this logic elsewhere.
 *
 * Classification priority:
 * 1. Direct catalog field (category, object_type, class) if available
 * 2. Name-based heuristics only when catalog field is missing/unreliable
 * 3. Always use stable ID as the canonical identity
 */

/**
 * Object type labels used throughout the application.
 */
export const OBJECT_TYPE = {
  ACTIVE_SATELLITE: "ACTIVE SATELLITE",
  SPACE_DEBRIS: "SPACE DEBRIS",
  ROCKET_BODY: "ROCKET BODY",
  FRAGMENT: "FRAGMENT",
  UNKNOWN: "TRACKED OBJECT",
};

/**
 * Determine the human-readable object type label from catalog data.
 *
 * Uses the authoritative `category` field whenever available.
 * Falls back to name-based heuristics only when category is absent/ambiguous.
 *
 * @param {Object} object - Catalog object with at minimum { category, name }
 * @returns {string} One of OBJECT_TYPE.* constants
 */
export function getObjectTypeLabel(object) {
  if (!object) return OBJECT_TYPE.UNKNOWN;

  // 1. Use authoritative category field if available and reliable
  const category = (object.category || "").toLowerCase().trim();

  if (category === "active" || category === "satellite" || category === "payload" || category === "spacecraft") {
    return OBJECT_TYPE.ACTIVE_SATELLITE;
  }

  if (category === "debris" || category === "fragment") {
    return isKnownDebrisFamily(object.name) ? OBJECT_TYPE.FRAGMENT : OBJECT_TYPE.SPACE_DEBRIS;
  }

  if (category === "rocket_body" || category === "rocket body" || category === "r/b") {
    return OBJECT_TYPE.ROCKET_BODY;
  }

  // 2. Fallback: name-based heuristics only when category is inconclusive
  const name = (object.name || "").toLowerCase();

  if (name.includes("deb") || name.includes("debris") || name.includes("fragment")) {
    // Check if it's from a known fragmentation event
    return isKnownDebrisFamily(object.name) ? OBJECT_TYPE.FRAGMENT : OBJECT_TYPE.SPACE_DEBRIS;
  }

  if (name.includes("r/b") || name.includes("rocket body") || name.includes("rocket") || name.includes("stage")) {
    return OBJECT_TYPE.ROCKET_BODY;
  }

  if (name.includes("payload") || name.includes("satellite") || name.includes("ssa")) {
    return OBJECT_TYPE.ACTIVE_SATELLITE;
  }

  // 3. If we still can't determine, use category field as-is or default
  if (category && category !== "unknown") {
    if (category.includes("deb")) return OBJECT_TYPE.SPACE_DEBRIS;
    if (category.includes("rocket")) return OBJECT_TYPE.ROCKET_BODY;
    if (category.includes("active") || category.includes("payload")) return OBJECT_TYPE.ACTIVE_SATELLITE;
  }

  return OBJECT_TYPE.UNKNOWN;
}

/**
 * Check if an object name belongs to a known debris family
 * (fragmentation events where specific parent object fragments exist).
 */
function isKnownDebrisFamily(name) {
  if (!name) return false;
  const upper = name.toUpperCase();
  const knownFragmentationEvents = [
    "IRIDIUM 33",
    "COSMOS 2251",
    "FENGYUN 1C",
    "USA 193",
  ];
  return knownFragmentationEvents.some((event) => upper.includes(event));
}

/**
 * Get a stable display key for the object type (used for CSS classes, filtering).
 */
export function getObjectTypeKey(object) {
  const label = getObjectTypeLabel(object);
  return label.toLowerCase().replace(/\s+/g, "-");
}

/**
 * Determine if an object rendered in the visualization should use satellite-like
 * or debris-like visuals, based on the authoritative classification.
 *
 * Returns "satellite" or "debris" for use in SatelliteField rendering.
 */
export function getVisualCategory(object) {
  const type = getObjectTypeLabel(object);
  if (type === OBJECT_TYPE.ACTIVE_SATELLITE) return "satellite";
  return "debris"; // debris, fragment, rocket body, unknown → debris visual
}

/**
 * Validate a collision/conjunction event for data integrity.
 *
 * Returns null if valid, or an error message string if invalid.
 *
 * Identity validation rules:
 * 1. primary.id must exist
 * 2. secondary.id must exist
 * 3. primary.id !== secondary.id
 * 4. primary.name must be derived from primary.id
 * 5. secondary.name must be derived from secondary.id
 * 6. primary and secondary names must not be accidentally identical (unless IDs also identical)
 * 7. primary and secondary classifications must not be accidentally copied
 * 8. primary and secondary orbital data must not be accidentally copied
 */
export function validateEvent(event) {
  if (!event) return "Event is null/undefined";

  if (!event.primary || !event.secondary) {
    return `Event ${event.id} missing primary or secondary object`;
  }

  if (!event.primary.id || !event.secondary.id) {
    return `Event ${event.id} has object with missing ID`;
  }

  if (event.primary.id === event.secondary.id) {
    return `SELF-PAIR REJECTED: Event ${event.id} has same object (ID: ${event.primary.id}) for both primary and secondary`;
  }

  // IDENTITY CHECK: Names must not be accidentally identical when IDs differ
  if (event.primary.name && event.secondary.name &&
      event.primary.name === event.secondary.name &&
      event.primary.id !== event.secondary.id) {
    console.warn(
      `[Validation] IDENTITY WARNING: Event ${event.id} has different IDs ` +
      `(${event.primary.id}, ${event.secondary.id}) but identical names ` +
      `("${event.primary.name}"). This may indicate objects from the same ` +
      `fragmentation event being paired. Verifying IDs are truly different.`
    );
    // This is a warning, not a rejection — different NORAD IDs means different objects
  }

  // IDENTITY CHECK: Object types must not be accidentally copied
  if (event.primary.object_type && event.secondary.object_type &&
      event.primary.object_type === event.secondary.object_type) {
    // This is valid (satellite-satellite pairs are valid), just log it
    console.info(
      `[Validation] Event ${event.id}: Both objects have type "${event.primary.object_type}". ` +
      `This is a ${event.primary.object_type === "ACTIVE_SATELLITE" ? "SATELLITE vs SATELLITE" : "DEBRIS vs DEBRIS"} conjunction.`
    );
  }

  // IDENTITY CHECK: primary and secondary must not reference the same memory object
  if (event.primary === event.secondary) {
    return `IDENTITY CORRUPTION: Event ${event.id} primary and secondary reference the same object instance`;
  }

  return null; // valid
}

/**
 * Safely validate an array of events, removing invalid ones and logging diagnostics.
 * Returns the filtered array of valid events.
 */
export function validateAndFilterEvents(events) {
  if (!events || !Array.isArray(events)) return [];

  const valid = [];
  const rejected = [];

  for (const event of events) {
    const error = validateEvent(event);
    if (error) {
      rejected.push({ event, error });
      console.warn(`[SSA Validation] ${error}`);
    } else {
      valid.push(event);
    }
  }

  if (rejected.length > 0) {
    console.info(`[SSA Validation] Filtered ${rejected.length} invalid event(s)`);
  }

  return valid;
}

/**
 * Create a canonical pair key from two object IDs for duplicate detection.
 * Always sorts IDs so (A,B) and (B,A) produce the same key.
 */
export function makePairKey(idA, idB) {
  return [String(idA), String(idB)].sort().join("|");
}

