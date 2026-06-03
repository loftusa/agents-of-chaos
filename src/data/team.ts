export interface Member {
  name: string;
  role: string;
}

// Current roster (mirrors the live Crucible page as of the port).
// Add or edit a line to change the team — no markup needed.
export const team: Member[] = [
  { name: "Alex Loftus", role: "Lead" },
  { name: "Jannik Brinkmann", role: "Lead" },
  { name: "Alice Rigg", role: "Red-teamer" },
  { name: "Giordano Rogers", role: "Red-teamer" },
  { name: "Negev Taglicht", role: "Red-teamer" },
  { name: "Antonio Mari", role: "Red-teamer" },
  { name: "Kevin Rigg", role: "Engineer" },
  { name: "Baris Gursakal", role: "Red-teamer" },
];
