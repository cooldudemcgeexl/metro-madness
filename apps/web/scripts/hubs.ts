// Metro St. Louis transit centers, per metrostlouis.org/system-maps/addresses
// ("Metro Transit Centers" entries whose name is "... Transit Center").
// Each hub lists the GTFS stop_ids that count as "being at" that center:
// its bus bays plus the MetroLink platform where there is one.
// `official: false` hubs are extra stops named "Transit Center" in the GTFS feed
// that Metro's address page does not list. They are optional in the planner.

export interface HubDef {
  id: string;
  name: string;
  state: "MO" | "IL";
  official: boolean;
  /** GTFS stop_ids */
  stops: string[];
}

const MISSOURI: HubDef[] = [
  // ---- Missouri ----
  { id: "BAL", name: "Ballas", state: "MO", official: true, stops: ["13967"] },
  {
    id: "BRW",
    name: "Brentwood I-64",
    state: "MO",
    official: true,
    stops: ["14779", "14756"],
  },
  {
    id: "CAT",
    name: "Catalan Loop",
    state: "MO",
    official: true,
    stops: ["393", "412"],
  },
  {
    id: "CWE",
    name: "Central West End",
    state: "MO",
    official: true,
    stops: ["14792", "16089", "10625"],
  },
  {
    id: "CIV",
    name: "Civic Center",
    state: "MO",
    official: true,
    stops: ["249", "7653", "7852", "14496", "15707", "10622"],
  },
  {
    id: "CLA",
    name: "Clayton",
    state: "MO",
    official: true,
    stops: ["14403", "14425", "14758"],
  },
  {
    id: "DEL",
    name: "Delmar Loop",
    state: "MO",
    official: true,
    stops: ["2030", "2097", "10627"],
  },
  {
    id: "FPD",
    name: "Forest Park-DeBaliviere",
    state: "MO",
    official: true,
    stops: ["1443", "1460", "10626"],
  },
  {
    id: "HGR",
    name: "Hampton-Gravois",
    state: "MO",
    official: true,
    stops: ["768"],
  },
  {
    id: "MPW",
    name: "Maplewood-Manchester",
    state: "MO",
    official: true,
    stops: ["4969", "16467", "14755"],
  },
  {
    id: "NBR",
    name: "North Broadway",
    state: "MO",
    official: true,
    stops: ["13487"],
  },
  {
    id: "NCO",
    name: "North County",
    state: "MO",
    official: true,
    stops: ["16146", "16251"],
  },
  {
    id: "NHA",
    name: "North Hanley",
    state: "MO",
    official: true,
    stops: ["13330", "16063", "10632"],
  },
  {
    id: "RHT",
    name: "Richmond Heights",
    state: "MO",
    official: true,
    stops: ["14757"],
  },
  {
    id: "RIV",
    name: "Riverview",
    state: "MO",
    official: true,
    stops: ["6649", "16090"],
  },
  {
    id: "RRD",
    name: "Rock Road",
    state: "MO",
    official: true,
    stops: ["7424", "10629"],
  },
  {
    id: "SHR",
    name: "Shrewsbury-Lansdowne I-44",
    state: "MO",
    official: true,
    stops: ["14769", "16303", "14753"],
  },
  {
    id: "WEL",
    name: "Wellston",
    state: "MO",
    official: true,
    stops: ["2424", "2495", "10628"],
  },
  // ---- Named "Transit Center" in GTFS but not on Metro's address list ----
  {
    id: "GRD",
    name: "Grand",
    state: "MO",
    official: true,
    stops: ["4074", "4135", "10624"],
  },
  {
    id: "UMS",
    name: "UMSL South",
    state: "MO",
    official: true,
    stops: ["9157", "10630"],
  },
  {
    id: "LRH",
    name: "Lockwood @ Rock Hill",
    state: "MO",
    official: false,
    stops: ["2908"],
  },
];

export const ILLINOIS: HubDef[] = [
  // ---- Illinois ----
  {
    id: "5MO",
    name: "5th & Missouri",
    state: "IL",
    official: true,
    stops: ["14330", "10616"],
  },
  {
    id: "BEL",
    name: "Belleville",
    state: "IL",
    official: true,
    stops: ["11102", "10605"],
  },
  {
    id: "COL",
    name: "College",
    state: "IL",
    official: true,
    stops: ["10606", "11103"],
  },
  {
    id: "EMP",
    name: "Emerson Park",
    state: "IL",
    official: true,
    stops: ["12702", "10599"],
  },
  {
    id: "FVH",
    name: "Fairview Heights",
    state: "IL",
    official: true,
    stops: ["14124", "10602"],
  },
  {
    id: "JJK",
    name: "Jackie Joyner-Kersee Center",
    state: "IL",
    official: true,
    stops: ["14280", "10600"],
  },
  {
    id: "MEM",
    name: "Memorial Hospital",
    state: "IL",
    official: true,
    stops: ["11427", "10603"],
  },
  {
    id: "SHS",
    name: "Shiloh-Scott",
    state: "IL",
    official: true,
    stops: ["14272", "14274"],
  },
  {
    id: "SWA",
    name: "Swansea",
    state: "IL",
    official: true,
    stops: ["11626", "10604"],
  },
  {
    id: "WPK",
    name: "Washington Park",
    state: "IL",
    official: true,
    stops: ["14125", "10601"],
  },
];

export const HUBS: HubDef[] = [...MISSOURI, ...ILLINOIS];
