// Util/checkoutStatus.js

/**
 * Determines the checkout status based on shift and checkout time in Colombo timezone.
 * 
 * @param {string} checkoutTimestamp - ISO timestamp string (e.g., from Supabase)
 * @param {string} shift - Employee's shift for the day: "A", "B", "C", or anything else (including null/undefined)
 * @param {string} project - Employee's project code (uppercase, trimmed)
 * @param {string} empId - Employee ID (as string)
 * @param {Set<string>} specialExemptIds - Set of employee IDs that are exempt from status rules
 * 
 * @returns {"Complete" | "Incomplete" | "Half Day" | "N/A"}
 */
export function getCheckoutStatus(
  checkoutTimestamp,
  shift,
  project = "",
  empId = "",
  specialExemptIds = new Set()
) {
  const trimmedProject = (project || "").toUpperCase().trim();

  // Special projects or exempt employees → N/A
  const specialProjects = ["STL", "ADMIN", "ER", "CLEANING", "JANITOR"];
  if (specialProjects.includes(trimmedProject) || specialExemptIds.has(empId)) {
    return "N/A";
  }

  // No valid working shift today → Complete (OFF, RD, etc.)
  if (!shift || !["A", "B", "C"].includes(shift)) {
    return "Complete";
  }

  // Convert timestamp to Colombo time for accurate hour/minute
  const checkoutDate = new Date(checkoutTimestamp);
  const colomboTime = new Date(
    checkoutDate.toLocaleString("en-US", { timeZone: "Asia/Colombo" })
  );
  const hour = colomboTime.getHours();
  const minute = colomboTime.getMinutes();

  // Helper to check time range
  const isInRange = (targetHour, startMin = 0, endMin = 30) => {
    if (hour !== targetHour) return false;
    return minute >= startMin && minute < endMin;
  };

  const isAtOrAfter = (targetHour, targetMin = 30) => {
    return hour > targetHour || (hour === targetHour && minute >= targetMin);
  };

  const isBefore = (targetHour, targetMin = 0) => {
    return hour < targetHour || (hour === targetHour && minute < targetMin);
  };

  if (shift === "A") {
    // Expected checkout: 1:00 PM – 1:30 PM
    if (isInRange(13, 0, 30)) return "Incomplete";     // 1:00 – 1:29 PM
    if (isAtOrAfter(13, 30)) return "Complete";        // 1:30 PM or later
    if (isBefore(13)) return "Half Day";               // Before 1:00 PM
    return "Complete"; // fallback (after 1:59 PM)
  }

  if (shift === "B") {
    // Expected checkout: 9:00 PM – 9:30 PM
    if (isInRange(21, 0, 30)) return "Incomplete";     // 9:00 – 9:29 PM
    if (isAtOrAfter(21, 30)) return "Complete";        // 9:30 PM or later
    if (isBefore(21)) return "Half Day";               // Before 9:00 PM
    return "Complete"; // next day checkout treated as complete
  }

  if (shift === "C") {
    // Expected checkout: 5:00 AM – 5:30 AM (next day)
    if (isInRange(5, 0, 30)) return "Incomplete";       // 5:00 – 5:29 AM
    if (isAtOrAfter(5, 30)) return "Complete";         // 5:30 AM or later
    if (isBefore(5)) return "Half Day";                // Before 5:00 AM
    return "Complete"; // after 5:59 AM
  }

  // Fallback
  return "Complete";
}