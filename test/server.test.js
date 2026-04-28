import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

process.env.NODE_ENV = "test";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const testDataDir = path.join(rootDir, "data");
const notesPath = path.join(testDataDir, "notes.json");
const conceptsPath = path.join(testDataDir, "concepts.json");
const quizzesPath = path.join(testDataDir, "quizzes.json");
const mapDataPath = path.join(testDataDir, "map.json");

const {
  addLlmConnections,
  computeDecayedConfidence,
  computeQuizPriority,
  createFallbackQuizItems,
  dataDir,
  ensureDataFiles,
  mapPath,
  normalizeMapData,
  readJson,
  resolveDataDir,
  sanitizeConceptRelations,
  selectQuizConcepts,
  upsertManualConnection,
  upsertNote,
  validateRelationsPayload,
  validateQuizPayload,
  validateExtractionPayload,
  writeJson
} = await import("../server.js");

async function resetData() {
  await fs.mkdir(testDataDir, { recursive: true });
  await fs.writeFile(notesPath, "[]\n", "utf8");
  await fs.writeFile(conceptsPath, "[]\n", "utf8");
  await fs.writeFile(quizzesPath, "[]\n", "utf8");
  await fs.writeFile(
    mapDataPath,
    JSON.stringify({ nodes: [], connections: [] }, null, 2) + "\n",
    "utf8"
  );
}

test("note save persists and updates existing note", async () => {
  await ensureDataFiles();
  await resetData();
  const notes = await readJson(notesPath, []);

  const createdNote = upsertNote(notes, {
    title: "Physics",
    content: "Newton's second law relates force, mass, and acceleration."
  });
  assert.equal(createdNote.title, "Physics");
  await writeJson(notesPath, notes);

  upsertNote(notes, {
    id: createdNote.id,
    title: "Physics",
    content:
      "Newton's second law relates force, mass, and acceleration. F = ma."
  });
  await writeJson(notesPath, notes);
  const persistedNotes = await readJson(notesPath, []);

  assert.equal(persistedNotes.length, 1);
  assert.match(persistedNotes[0].content, /F = ma/);
});

test("test environment stores data in the project data directory", () => {
  assert.equal(resolveDataDir(), dataDir);
  assert.equal(dataDir, testDataDir);
  assert.equal(mapPath, mapDataPath);
});

test("PROBE_DATA_DIR overrides the default storage location", () => {
  const original = process.env.PROBE_DATA_DIR;
  process.env.PROBE_DATA_DIR = "./tmp/probe-data";

  try {
    assert.equal(resolveDataDir(), path.resolve(rootDir, "tmp/probe-data"));
  } finally {
    if (original === undefined) {
      delete process.env.PROBE_DATA_DIR;
    } else {
      process.env.PROBE_DATA_DIR = original;
    }
  }
});

test("concept listing filters by note id", async () => {
  await ensureDataFiles();
  await resetData();

  await fs.writeFile(
    conceptsPath,
    JSON.stringify(
      [
        {
          id: "concept_1",
          noteId: "note_a",
          name: "Force",
          category: "engineering",
          summary: "Force creates acceleration.",
          sourceSpan: "Newton's second law",
          confidenceScore: 0.5,
          recallCount: 0,
          lastReviewedAt: null
        },
        {
          id: "concept_2",
          noteId: "note_b",
          name: "Cell",
          category: "general",
          summary: "Basic unit of life.",
          sourceSpan: "Cell theory",
          confidenceScore: 0.4,
          recallCount: 0,
          lastReviewedAt: null
        }
      ],
      null,
      2
    ),
    "utf8"
  );

  const concepts = await readJson(conceptsPath, []);
  const filtered = concepts.filter((concept) => concept.noteId === "note_a");

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, "Force");
});

test("map data file is initialized", async () => {
  await ensureDataFiles();
  await resetData();
  const mapData = await readJson(mapDataPath, null);

  assert.deepEqual(mapData, { nodes: [], connections: [] });
});

test("map normalization filters stale nodes and connections", () => {
  const concepts = [
    { id: "concept_a" },
    { id: "concept_b" }
  ];
  const normalized = normalizeMapData(
    {
      nodes: [
        { conceptId: "concept_a", x: 20, y: 30, updatedAt: "2026-04-28T10:00:00.000Z" },
        { conceptId: "missing", x: 50, y: 80 }
      ],
      connections: [
        {
          id: "connection_valid",
          sourceConceptId: "concept_b",
          targetConceptId: "concept_a",
          strength: 8,
          origin: "llm",
          createdAt: "2026-04-28T10:00:00.000Z",
          updatedAt: "2026-04-28T10:00:00.000Z"
        },
        {
          id: "connection_stale",
          sourceConceptId: "concept_a",
          targetConceptId: "missing",
          strength: 3
        }
      ]
    },
    concepts
  );

  assert.deepEqual(normalized.nodes.map((node) => node.conceptId), ["concept_a"]);
  assert.equal(normalized.connections.length, 1);
  assert.equal(normalized.connections[0].sourceConceptId, "concept_a");
  assert.equal(normalized.connections[0].targetConceptId, "concept_b");
  assert.equal(normalized.connections[0].strength, 5);
});

test("manual connection upsert normalizes pairs and clamps strength", () => {
  const mapData = { nodes: [], connections: [] };
  const concepts = [{ id: "concept_a" }, { id: "concept_b" }];
  const created = upsertManualConnection(
    mapData,
    {
      sourceConceptId: "concept_b",
      targetConceptId: "concept_a",
      strength: 9
    },
    concepts
  );

  assert.equal(created.sourceConceptId, "concept_a");
  assert.equal(created.targetConceptId, "concept_b");
  assert.equal(created.strength, 5);
  assert.equal(created.origin, "manual");

  const updated = upsertManualConnection(
    mapData,
    {
      sourceConceptId: "concept_a",
      targetConceptId: "concept_b",
      strength: 2
    },
    concepts
  );

  assert.equal(mapData.connections.length, 1);
  assert.equal(updated.id, created.id);
  assert.equal(updated.strength, 2);
});

test("llm relation addition preserves existing manual connections", () => {
  const concepts = [
    { id: "concept_a" },
    { id: "concept_b" },
    { id: "concept_c" }
  ];
  const mapData = {
    nodes: [],
    connections: [
      {
        id: "connection_manual",
        sourceConceptId: "concept_a",
        targetConceptId: "concept_b",
        strength: 4,
        origin: "manual",
        createdAt: "2026-04-28T10:00:00.000Z",
        updatedAt: "2026-04-28T10:00:00.000Z"
      }
    ]
  };
  const updated = addLlmConnections(
    mapData,
    [
      { sourceConceptId: "concept_b", targetConceptId: "concept_a", strength: 1 },
      { sourceConceptId: "concept_a", targetConceptId: "concept_c", strength: 3 }
    ],
    concepts
  );

  assert.equal(updated.connections.length, 2);
  assert.equal(updated.connections[0].origin, "manual");
  assert.equal(updated.connections[0].strength, 4);
  assert.equal(updated.connections[1].origin, "llm");
});

test("relation sanitization drops malformed candidates but keeps usable ones", () => {
  const relations = sanitizeConceptRelations(
    [
      { sourceConceptId: "concept_old", targetConceptId: "concept_new", strength: 4 },
      { sourceConceptId: "concept_old", targetConceptId: "concept_missing", strength: 5 },
      { sourceConceptId: "concept_old", targetConceptId: "concept_other_old", strength: 3 },
      { sourceConceptId: "concept_new", targetConceptId: "concept_new", strength: 2 },
      { sourceConceptId: "concept_new", targetConceptId: "concept_old", strength: 9 }
    ],
    [
      { id: "concept_old" },
      { id: "concept_other_old" },
      { id: "concept_new" }
    ],
    [{ id: "concept_new" }]
  );

  assert.deepEqual(relations, [
    {
      sourceConceptId: "concept_old",
      targetConceptId: "concept_new",
      strength: 4
    }
  ]);
});

test("empty usable relation set is valid when the model returns no relations", () => {
  assert.doesNotThrow(() =>
    validateRelationsPayload(
      { relations: [] },
      [{ id: "concept_a" }],
      [{ id: "concept_a" }]
    )
  );
});

test("rebuild-style llm relation addition starts from empty connections", () => {
  const concepts = [{ id: "concept_a" }, { id: "concept_b" }];
  const rebuilt = addLlmConnections(
    { nodes: [{ conceptId: "concept_a", x: 10, y: 20 }], connections: [] },
    [{ sourceConceptId: "concept_a", targetConceptId: "concept_b", strength: 4 }],
    concepts
  );

  assert.deepEqual(rebuilt.nodes, [{ conceptId: "concept_a", x: 10, y: 20 }]);
  assert.equal(rebuilt.connections.length, 1);
  assert.equal(rebuilt.connections[0].origin, "llm");
});

test("rejects empty notes", async () => {
  await ensureDataFiles();
  await resetData();
  assert.throws(
    () =>
      upsertNote([], {
      title: "Empty",
      content: "   "
      }),
    /required/
  );
});

test("rejects malformed concept payloads", () => {
  assert.throws(
    () =>
      validateExtractionPayload({
        category: "general",
        concepts: [{ name: 12, summary: "bad", sourceSpan: "x" }]
      }),
    /malformed/
  );
});

test("quiz selection prioritizes weaker, less-practiced, and stale concepts", () => {
  const selected = selectQuizConcepts(
    [
      {
        id: "concept_recent",
        confidenceScore: 0.9,
        recallCount: 4,
        lastReviewedAt: "2026-04-27T10:00:00.000Z"
      },
      {
        id: "concept_stale",
        confidenceScore: 0.8,
        recallCount: 1,
        lastReviewedAt: "2026-03-27T10:00:00.000Z"
      },
      {
        id: "concept_low",
        confidenceScore: 0.2,
        recallCount: 0,
        lastReviewedAt: null
      }
    ],
    2,
    new Date("2026-04-28T10:00:00.000Z")
  );

  assert.deepEqual(
    selected.map((concept) => concept.id),
    ["concept_stale", "concept_low"]
  );
});

test("confidence decays after time passes", () => {
  const fresh = computeDecayedConfidence(
    {
      confidenceScore: 0.9,
      recallCount: 1,
      lastReviewedAt: "2026-04-28T10:00:00.000Z"
    },
    new Date("2026-04-28T10:00:00.000Z")
  );
  const stale = computeDecayedConfidence(
    {
      confidenceScore: 0.9,
      recallCount: 1,
      lastReviewedAt: "2026-04-01T10:00:00.000Z"
    },
    new Date("2026-04-28T10:00:00.000Z")
  );

  assert.equal(fresh, 0.9);
  assert.ok(stale < fresh);
});

test("quiz priority increases for lower confidence and fewer recalls", () => {
  const harder = computeQuizPriority(
    {
      confidenceScore: 0.3,
      recallCount: 0,
      lastReviewedAt: "2026-04-10T10:00:00.000Z"
    },
    new Date("2026-04-28T10:00:00.000Z")
  );
  const easier = computeQuizPriority(
    {
      confidenceScore: 0.85,
      recallCount: 5,
      lastReviewedAt: "2026-04-27T10:00:00.000Z"
    },
    new Date("2026-04-28T10:00:00.000Z")
  );

  assert.ok(harder > easier);
});

test("fallback quiz generation builds one item per concept", () => {
  const items = createFallbackQuizItems([
    {
      id: "concept_force",
      name: "Force",
      category: "engineering",
      summary: "Force equals mass times acceleration.",
      sourceSpan: "F = ma"
    }
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].conceptId, "concept_force");
  assert.equal(items[0].questionType, "application");
});

test("rejects malformed quiz payloads", () => {
  assert.throws(
    () =>
      validateQuizPayload(
        {
          items: [
            {
              conceptId: "missing",
              questionType: "flashcard",
              prompt: 12,
              answer: "A",
              rubric: "R"
            }
          ]
        },
        [{ id: "concept_1" }]
      ),
    /malformed/
  );
});

test("rejects malformed relation payloads", () => {
  assert.throws(
    () =>
      validateRelationsPayload(
        {
          relations: [
            {
              sourceConceptId: "concept_a",
              targetConceptId: "concept_b",
              strength: 3
            }
          ]
        },
        [{ id: "concept_a" }, { id: "concept_b" }],
        [{ id: "concept_c" }]
      ),
    /no usable/
  );
});
