// M Tucker A — 2025 Infinity Fitness Program
// Source: MTuckerJan25v2a.pdf
// Schema: each exercise has 6 weeks of prescriptions (sets, tempo, reps, rest in seconds).
// Tempo notation E-Is-C-Ic = Eccentric / Isometric stretched / Concentric / Isometric contracted.
// Reps in parentheses (e.g. "(6-8)") = rep range. "(4-6)-(6-8)" = drop / cluster style range
//   first range guides intensity, second is total per set as transcribed verbatim from the sheet.
// Rest is per set in seconds, except where notes specify between-arm/leg rest.

window.PLAN = {
  program: "M Tucker A",
  source: "Infinity Fitness — MTuckerJan25v2a.pdf",
  weeks: 6,
  days: [
    {
      id: "day1",
      name: "Day 1 — Upper Push/Pull",
      exercises: [
        {
          code: "A1",
          name: "Serrano extensions",
          notes: "30 deg incline",
          weeks: [
            { week: 1, sets: 3, tempo: "3-1-1-1", reps: "(6-8)",   rest: 45 },
            { week: 2, sets: 3, tempo: "3-1-1-1", reps: "(6-8)",   rest: 45 },
            { week: 3, sets: 3, tempo: "3-1-1-1", reps: "(6-8)",   rest: 45 },
            { week: 4, sets: 3, tempo: "3-1-1-1", reps: "(7-9)",   rest: 30 },
            { week: 5, sets: 2, tempo: "3-1-1-1", reps: "(7-9)",   rest: 30 },
            { week: 6, sets: 3, tempo: "3-1-1-1", reps: "(7-9)",   rest: 30 }
          ]
        },
        {
          code: "A2",
          name: "Prone bilateral trap 2 lift",
          notes: "30 deg incline",
          weeks: [
            { week: 1, sets: 3, tempo: "3-1-1-2", reps: "(6-8)", rest: 45 },
            { week: 2, sets: 3, tempo: "3-1-1-2", reps: "(6-8)", rest: 45 },
            { week: 3, sets: 3, tempo: "3-1-1-2", reps: "(6-8)", rest: 45 },
            { week: 4, sets: 3, tempo: "3-1-1-3", reps: "(7-9)", rest: 30 },
            { week: 5, sets: 2, tempo: "3-1-1-3", reps: "(7-9)", rest: 30 },
            { week: 6, sets: 3, tempo: "3-1-1-3", reps: "(7-9)", rest: 30 }
          ]
        },
        {
          code: "B1",
          name: "Wide grip / rhomboid pull down",
          notes: "wide grip 3 inches wider than shoulder width",
          weeks: [
            { week: 1, sets: 3, tempo: "3-1-1-2", reps: "(4-6)-(6-8)", rest: 60 },
            { week: 2, sets: 3, tempo: "3-1-1-2", reps: "(4-6)-(6-8)", rest: 60 },
            { week: 3, sets: 3, tempo: "3-1-1-2", reps: "(5-7)-(7-9)", rest: 60 },
            { week: 4, sets: 3, tempo: "3-1-1-3", reps: "(5-7)-(7-9)", rest: 45 },
            { week: 5, sets: 2, tempo: "3-1-1-3", reps: "(6-8)-(8-10)", rest: 45 },
            { week: 6, sets: 3, tempo: "3-1-1-3", reps: "(6-8)-(8-10)", rest: 45 }
          ]
        },
        {
          code: "B2",
          name: "Semi neutral grip press",
          notes: "30 deg incline",
          weeks: [
            { week: 1, sets: 3, tempo: "3-2-1-1", reps: "(4-6)-(6-8)", rest: 60 },
            { week: 2, sets: 3, tempo: "3-2-1-1", reps: "(4-6)-(6-8)", rest: 60 },
            { week: 3, sets: 3, tempo: "3-2-1-1", reps: "(5-7)-(7-9)", rest: 60 },
            { week: 4, sets: 3, tempo: "3-3-1-1", reps: "(5-7)-(7-9)", rest: 45 },
            { week: 5, sets: 2, tempo: "3-3-1-1", reps: "(6-8)-(8-10)", rest: 45 },
            { week: 6, sets: 3, tempo: "3-3-1-1", reps: "(6-8)-(8-10)", rest: 45 }
          ]
        },
        {
          code: "C1",
          name: "Chest supported UH Row",
          notes: "bring db to hip, palms facing up, 30 deg incline",
          weeks: [
            { week: 1, sets: 3, tempo: "3-1-1-2", reps: "(4-6)-(6-8)", rest: 60 },
            { week: 2, sets: 3, tempo: "3-1-1-2", reps: "(4-6)-(6-8)", rest: 60 },
            { week: 3, sets: 3, tempo: "3-1-1-2", reps: "(5-7)-(7-9)", rest: 60 },
            { week: 4, sets: 3, tempo: "3-1-1-3", reps: "(5-7)-(7-9)", rest: 45 },
            { week: 5, sets: 2, tempo: "3-1-1-3", reps: "(6-8)-(8-10)", rest: 45 },
            { week: 6, sets: 3, tempo: "3-1-1-3", reps: "(6-8)-(8-10)", rest: 45 }
          ]
        },
        {
          code: "C2",
          name: "Push ups",
          notes: "",
          weeks: [
            { week: 1, sets: 3, tempo: "4-1-x-0", reps: "10", rest: 60 },
            { week: 2, sets: 3, tempo: "4-1-x-0", reps: "10", rest: 60 },
            { week: 3, sets: 3, tempo: "4-1-x-0", reps: "12", rest: 60 },
            { week: 4, sets: 3, tempo: "5-1-x-0", reps: "12", rest: 45 },
            { week: 5, sets: 2, tempo: "5-1-x-0", reps: "14", rest: 45 },
            { week: 6, sets: 3, tempo: "5-1-x-0", reps: "14", rest: 45 }
          ]
        }
      ]
    },
    {
      id: "day2",
      name: "Day 2 — Lower",
      exercises: [
        {
          code: "A1",
          name: "Goblet Squat",
          notes: "touch glutes on parallel depth marker",
          weeks: [
            { week: 1, sets: 3, tempo: "4-2-1-0", reps: "(6-8)", rest: 60 },
            { week: 2, sets: 3, tempo: "4-2-1-0", reps: "(6-8)", rest: 60 },
            { week: 3, sets: 3, tempo: "4-2-1-0", reps: "(6-8)", rest: 60 },
            { week: 4, sets: 3, tempo: "5-2-1-0", reps: "(7-9)", rest: 45 },
            { week: 5, sets: 2, tempo: "5-2-1-0", reps: "(7-9)", rest: 45 },
            { week: 6, sets: 3, tempo: "5-2-1-0", reps: "(7-9)", rest: 45 }
          ]
        },
        {
          code: "B1",
          name: "Body weight squat",
          notes: "touch glutes on parallel depth marker",
          weeks: [
            { week: 1, sets: 3, tempo: "3-2-1-1", reps: "16", rest: 60 },
            { week: 2, sets: 3, tempo: "3-2-1-1", reps: "16", rest: 60 },
            { week: 3, sets: 3, tempo: "3-2-1-1", reps: "18", rest: 60 },
            { week: 4, sets: 3, tempo: "3-3-1-1", reps: "18", rest: 45 },
            { week: 5, sets: 2, tempo: "3-3-1-1", reps: "20", rest: 45 },
            { week: 6, sets: 3, tempo: "3-3-1-1", reps: "20", rest: 45 }
          ]
        },
        {
          code: "B2",
          name: "Rear Leg Elevated Lunge",
          notes: "20 seconds rest between legs",
          weeks: [
            { week: 1, sets: 3, tempo: "3-2-1-1", reps: "(6-8)", rest: 60 },
            { week: 2, sets: 3, tempo: "3-2-1-1", reps: "(6-8)", rest: 60 },
            { week: 3, sets: 3, tempo: "3-2-1-1", reps: "(6-8)", rest: 60 },
            { week: 4, sets: 3, tempo: "3-3-1-1", reps: "(7-9)", rest: 45 },
            { week: 5, sets: 2, tempo: "3-3-1-1", reps: "(7-9)", rest: 45 },
            { week: 6, sets: 3, tempo: "3-3-1-1", reps: "(7-9)", rest: 45 }
          ]
        },
        {
          code: "B2b",
          name: "Ball squeeze",
          notes: "squeeze med ball between knees, lay on back (sheet labels this B2 a second time)",
          weeks: [
            { week: 1, sets: 3, tempo: "na", reps: "20 sec", rest: 60 },
            { week: 2, sets: 3, tempo: "na", reps: "20 sec", rest: 60 },
            { week: 3, sets: 3, tempo: "na", reps: "25 sec", rest: 60 },
            { week: 4, sets: 3, tempo: "na", reps: "25 sec", rest: 45 },
            { week: 5, sets: 2, tempo: "na", reps: "30 sec", rest: 45 },
            { week: 6, sets: 3, tempo: "na", reps: "30 sec", rest: 45 }
          ]
        },
        {
          code: "C1",
          name: "Hamstring Pray contractions",
          notes: "padding under knees",
          weeks: [
            { week: 1, sets: 3, tempo: "na", reps: "20 sec", rest: 60 },
            { week: 2, sets: 3, tempo: "na", reps: "20 sec", rest: 60 },
            { week: 3, sets: 3, tempo: "na", reps: "25 sec", rest: 60 },
            { week: 4, sets: 3, tempo: "na", reps: "25 sec", rest: 45 },
            { week: 5, sets: 2, tempo: "na", reps: "30 sec", rest: 45 },
            { week: 6, sets: 3, tempo: "na", reps: "30 sec", rest: 45 }
          ]
        },
        {
          code: "D1",
          name: "Unilateral toe raise",
          notes: "",
          weeks: [
            { week: 1, sets: 2, tempo: "3-2-1-2", reps: "8",  rest: 45 },
            { week: 2, sets: 2, tempo: "3-2-1-2", reps: "8",  rest: 45 },
            { week: 3, sets: 2, tempo: "3-2-1-2", reps: "10", rest: 45 },
            { week: 4, sets: 2, tempo: "4-2-1-2", reps: "10", rest: 30 },
            { week: 5, sets: 2, tempo: "4-2-1-2", reps: "12", rest: 30 },
            { week: 6, sets: 2, tempo: "4-2-1-2", reps: "12", rest: 30 }
          ]
        },
        {
          code: "D2",
          name: "Standing unilateral calf raise",
          notes: "elevate working foot",
          weeks: [
            { week: 1, sets: 2, tempo: "3-2-1-2", reps: "6", rest: 45 },
            { week: 2, sets: 2, tempo: "3-2-1-2", reps: "6", rest: 45 },
            { week: 3, sets: 2, tempo: "3-2-1-2", reps: "7", rest: 45 },
            { week: 4, sets: 2, tempo: "3-2-1-3", reps: "7", rest: 30 },
            { week: 5, sets: 2, tempo: "3-2-1-3", reps: "8", rest: 30 },
            { week: 6, sets: 2, tempo: "3-2-1-3", reps: "8", rest: 30 }
          ]
        }
      ]
    },
    {
      id: "day3",
      name: "Day 3 — Arms",
      exercises: [
        {
          code: "A1",
          name: "A Press",
          notes: "",
          weeks: [
            { week: 1, sets: 2, tempo: "3-1-1-2", reps: "(6-8)", rest: 45 },
            { week: 2, sets: 2, tempo: "3-1-1-2", reps: "(6-8)", rest: 45 },
            { week: 3, sets: 2, tempo: "3-1-1-2", reps: "(6-8)", rest: 45 },
            { week: 4, sets: 2, tempo: "3-1-1-3", reps: "(7-9)", rest: 30 },
            { week: 5, sets: 2, tempo: "3-1-1-3", reps: "(7-9)", rest: 30 },
            { week: 6, sets: 2, tempo: "3-1-1-3", reps: "(7-9)", rest: 30 }
          ]
        },
        {
          code: "A2",
          name: "Supinated lat push down",
          notes: "",
          weeks: [
            { week: 1, sets: 2, tempo: "3-1-1-3", reps: "(6-8)", rest: 45 },
            { week: 2, sets: 2, tempo: "3-1-1-3", reps: "(6-8)", rest: 45 },
            { week: 3, sets: 2, tempo: "3-1-1-3", reps: "(6-8)", rest: 45 },
            { week: 4, sets: 2, tempo: "3-1-1-4", reps: "(7-9)", rest: 30 },
            { week: 5, sets: 2, tempo: "3-1-1-4", reps: "(7-9)", rest: 30 },
            { week: 6, sets: 2, tempo: "3-1-1-4", reps: "(7-9)", rest: 30 }
          ]
        },
        {
          code: "B1",
          name: "Preacher unilateral db curl",
          notes: "no rest between arms",
          weeks: [
            { week: 1, sets: 3, tempo: "4-2-1-1", reps: "(4-6)-(6-8)", rest: 45 },
            { week: 2, sets: 3, tempo: "4-2-1-1", reps: "(4-6)-(6-8)", rest: 45 },
            { week: 3, sets: 3, tempo: "4-2-1-1", reps: "(5-7)-(7-9)", rest: 45 },
            { week: 4, sets: 3, tempo: "5-2-1-1", reps: "(5-7)-(7-9)", rest: 30 },
            { week: 5, sets: 2, tempo: "5-2-1-1", reps: "(6-8)-(8-10)", rest: 30 },
            { week: 6, sets: 3, tempo: "5-2-1-1", reps: "(6-8)-(8-10)", rest: 30 }
          ]
        },
        {
          code: "B2",
          name: "Prone Hammer curl",
          notes: "30 deg incline, palms facing each other",
          weeks: [
            { week: 1, sets: 3, tempo: "3-1-1-2", reps: "(4-6)-(6-8)", rest: 60 },
            { week: 2, sets: 3, tempo: "3-1-1-2", reps: "(4-6)-(6-8)", rest: 60 },
            { week: 3, sets: 3, tempo: "3-1-1-2", reps: "(5-7)-(7-9)", rest: 60 },
            { week: 4, sets: 3, tempo: "3-1-1-3", reps: "(5-7)-(7-9)", rest: 45 },
            { week: 5, sets: 2, tempo: "3-1-1-3", reps: "(6-8)-(8-10)", rest: 45 },
            { week: 6, sets: 3, tempo: "3-1-1-3", reps: "(6-8)-(8-10)", rest: 45 }
          ]
        },
        {
          code: "C1",
          name: "Prone db triceps kick back (supinated)",
          notes: "supinated grip, 30 deg incline",
          weeks: [
            { week: 1, sets: 3, tempo: "3-1-1-3", reps: "(4-6)-(6-8)", rest: 45 },
            { week: 2, sets: 3, tempo: "3-1-1-3", reps: "(4-6)-(6-8)", rest: 45 },
            { week: 3, sets: 3, tempo: "3-1-1-3", reps: "(5-7)-(7-9)", rest: 45 },
            { week: 4, sets: 3, tempo: "3-1-1-4", reps: "(5-7)-(7-9)", rest: 30 },
            { week: 5, sets: 2, tempo: "3-1-1-4", reps: "(6-8)-(8-10)", rest: 30 },
            { week: 6, sets: 3, tempo: "3-1-1-4", reps: "(6-8)-(8-10)", rest: 30 }
          ]
        },
        {
          code: "C2",
          name: "Prone db triceps kick back (neutral)",
          notes: "neutral grip, 30 deg incline",
          weeks: [
            { week: 1, sets: 3, tempo: "2-1-1-1", reps: "(4-6)-(6-8)", rest: 60 },
            { week: 2, sets: 3, tempo: "2-1-1-1", reps: "(4-6)-(6-8)", rest: 60 },
            { week: 3, sets: 3, tempo: "2-1-1-1", reps: "(5-7)-(7-9)", rest: 60 },
            { week: 4, sets: 3, tempo: "2-1-1-1", reps: "(5-7)-(7-9)", rest: 45 },
            { week: 5, sets: 2, tempo: "2-1-1-1", reps: "(6-8)-(8-10)", rest: 45 },
            { week: 6, sets: 3, tempo: "2-1-1-1", reps: "(6-8)-(8-10)", rest: 45 }
          ]
        }
      ]
    },
    {
      id: "day4",
      name: "Day 4 — Core",
      exercises: [
        {
          code: "A1",
          name: "Swiss ball leg lower",
          notes: "squeeze swiss ball between ankles, keep lower back pressed into floor",
          weeks: [
            { week: 1, sets: 4, tempo: "5-1-1-1", reps: "6", rest: 45 },
            { week: 2, sets: 4, tempo: "5-1-1-1", reps: "6", rest: 45 },
            { week: 3, sets: 4, tempo: "5-1-1-1", reps: "7", rest: 45 },
            { week: 4, sets: 4, tempo: "6-1-1-1", reps: "7", rest: 30 },
            { week: 5, sets: 3, tempo: "6-1-1-1", reps: "8", rest: 30 },
            { week: 6, sets: 4, tempo: "6-1-1-1", reps: "8", rest: 30 }
          ]
        },
        {
          code: "A2",
          name: "Standing cable core contraction / rotation",
          notes: "",
          weeks: [
            { week: 1, sets: 4, tempo: "na", reps: "6", rest: 45 },
            { week: 2, sets: 4, tempo: "na", reps: "6", rest: 45 },
            { week: 3, sets: 4, tempo: "na", reps: "7", rest: 45 },
            { week: 4, sets: 4, tempo: "na", reps: "7", rest: 30 },
            { week: 5, sets: 3, tempo: "na", reps: "8", rest: 30 },
            { week: 6, sets: 4, tempo: "na", reps: "8", rest: 30 }
          ]
        },
        {
          code: "B1",
          name: "Partial swiss ball crunch",
          notes: "",
          weeks: [
            { week: 1, sets: 4, tempo: "3-2-1-3", reps: "6", rest: 45 },
            { week: 2, sets: 4, tempo: "3-2-1-3", reps: "6", rest: 45 },
            { week: 3, sets: 4, tempo: "3-2-1-3", reps: "7", rest: 45 },
            { week: 4, sets: 4, tempo: "3-2-1-3", reps: "7", rest: 30 },
            { week: 5, sets: 3, tempo: "3-2-1-3", reps: "8", rest: 30 },
            { week: 6, sets: 4, tempo: "3-2-1-3", reps: "8", rest: 30 }
          ]
        },
        {
          code: "B2",
          name: "Back extensions",
          notes: "arms stretched out ahead",
          weeks: [
            { week: 1, sets: 4, tempo: "3-1-1-3", reps: "6", rest: 45 },
            { week: 2, sets: 4, tempo: "3-1-1-3", reps: "6", rest: 45 },
            { week: 3, sets: 4, tempo: "3-1-1-3", reps: "7", rest: 45 },
            { week: 4, sets: 4, tempo: "3-1-1-4", reps: "7", rest: 30 },
            { week: 5, sets: 3, tempo: "3-1-1-4", reps: "8", rest: 30 },
            { week: 6, sets: 4, tempo: "3-1-1-4", reps: "8", rest: 30 }
          ]
        }
      ]
    }
  ]
};
