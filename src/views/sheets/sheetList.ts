/**
 * The drawing set, in order. Everything that lists the sheets reads this: the title block,
 * the cover sheet index, the app's tabs, the PDF export, and the snapshot and smoke scripts.
 */
export const DISCIPLINES = [
  { key: 'G', title: 'General' },
  { key: 'A', title: 'Architectural' },
  { key: 'S', title: 'Structural framing' },
] as const;

export type Discipline = (typeof DISCIPLINES)[number]['key'];

export const SHEETS = [
  { id: 'G-001', title: 'Cover Sheet' },
  { id: 'G-002', title: 'Estimate Summary' },
  { id: 'A-100', title: 'Site Plan' },
  { id: 'A-101', title: 'Floor Plan' },
  { id: 'A-102', title: 'Roof Plan' },
  { id: 'A-103', title: 'Foundation Plan' },
  { id: 'A-201', title: 'Exterior Elevations' },
  { id: 'A-202', title: 'Exterior Elevations' },
  { id: 'A-301', title: 'Building Section' },
  { id: 'A-601', title: 'Schedules' },
  { id: 'A-602', title: 'Envelope Schedule' },
  { id: 'S-001', title: 'Framing Notes and Details' },
  { id: 'S-101', title: 'Floor Framing Plan' },
  { id: 'S-102', title: 'Wall Framing Plan' },
  { id: 'S-103', title: 'Ceiling and Roof Framing Plan' },
  { id: 'S-201', title: 'Wall Framing Elevations' },
  { id: 'S-202', title: 'Wall Framing Elevations' },
  { id: 'S-203', title: 'Wall Framing Elevations' },
  { id: 'S-601', title: 'Cut List' },
  { id: 'S-602', title: 'Framing Schedules and Cost' },
  { id: 'S-603', title: 'Buy List' },
] as const;

export type SheetId = (typeof SHEETS)[number]['id'];

export const SHEET_IDS: SheetId[] = SHEETS.map((s) => s.id);

export const disciplineOf = (id: SheetId) => id[0] as Discipline;

export const isSheetId = (s: string | null | undefined): s is SheetId => !!s && (SHEET_IDS as string[]).includes(s);
