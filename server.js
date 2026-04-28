import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const legacyDataDir = path.join(__dirname, "data");
const dataDir = resolveDataDir();
const notesPath = path.join(dataDir, "notes.json");
const directoriesPath = path.join(dataDir, "directories.json");
const conceptsPath = path.join(dataDir, "concepts.json");
const quizzesPath = path.join(dataDir, "quizzes.json");
const mapPath = path.join(dataDir, "map.json");

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const categoryOptions = [
  "memorization",
  "engineering",
  "social_science",
  "general"
];

function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(
    express.static(path.join(__dirname, "public"), {
      extensions: ["html"]
    })
  );

  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  app.get("/quizzes", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "quizzes.html"));
  });

  app.get("/map", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "map.html"));
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, hasOpenAI: Boolean(client) });
  });

  app.get("/api/notes", async (_req, res, next) => {
    try {
      const notes = await readJson(notesPath, []);
      res.json(sortNotes(notes));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notes/:noteId/move", async (req, res, next) => {
    try {
      const notes = await readJson(notesPath, []);
      const directories = normalizeDirectories(await readJson(directoriesPath, []));
      const movedNote = moveNote(notes, req.params.noteId, req.body, directories);
      await writeJson(notesPath, sortNotes(notes));
      res.json(movedNote);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/directories", async (_req, res, next) => {
    try {
      const directories = normalizeDirectories(await readJson(directoriesPath, []));
      res.json(sortDirectories(directories));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/directories", async (req, res, next) => {
    try {
      const directories = normalizeDirectories(await readJson(directoriesPath, []));
      const directory = createDirectory(directories, req.body);
      await writeJson(directoriesPath, sortDirectories(directories));
      res.json(directory);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/directories/:directoryId", async (req, res, next) => {
    try {
      const directories = normalizeDirectories(await readJson(directoriesPath, []));
      const directory = updateDirectory(directories, req.params.directoryId, req.body);
      await writeJson(directoriesPath, sortDirectories(directories));
      res.json(directory);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/directories/:directoryId/move", async (req, res, next) => {
    try {
      const directories = normalizeDirectories(await readJson(directoriesPath, []));
      const directory = moveDirectory(directories, req.params.directoryId, req.body);
      await writeJson(directoriesPath, sortDirectories(directories));
      res.json(directory);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/directories/:directoryId", async (req, res, next) => {
    try {
      const directories = normalizeDirectories(await readJson(directoriesPath, []));
      const notes = await readJson(notesPath, []);
      deleteDirectory(directories, notes, req.params.directoryId);
      await writeJson(directoriesPath, sortDirectories(directories));
      await writeJson(notesPath, sortNotes(notes));
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/concepts", async (req, res, next) => {
    try {
      const concepts = await readJson(conceptsPath, []);
      const noteId = req.query.noteId;
      const filtered = noteId
        ? concepts.filter((concept) => concept.noteId === noteId)
        : concepts;
      res.json(filtered);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/quizzes", async (req, res, next) => {
    try {
      const quizzes = await readJson(quizzesPath, []);
      const noteId = req.query.noteId;
      const filtered = noteId
        ? quizzes.filter((quiz) => quiz.noteId === noteId)
        : quizzes;
      res.json(sortQuizzes(filtered));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/map", async (_req, res, next) => {
    try {
      const concepts = await readJson(conceptsPath, []);
      const mapData = await readJson(mapPath, createEmptyMap());
      const normalizedMap = normalizeMapData(mapData, concepts);
      res.json({ concepts, ...normalizedMap });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notes", async (req, res, next) => {
    try {
      const notes = await readJson(notesPath, []);
      const directories = normalizeDirectories(await readJson(directoriesPath, []));
      const savedNote = upsertNote(notes, req.body, directories);
      await writeJson(notesPath, sortNotes(notes));
      res.json(savedNote);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notes/:noteId/extract", async (req, res, next) => {
    try {
      const notes = await readJson(notesPath, []);
      const note = notes.find((entry) => entry.id === req.params.noteId);

      if (!note) {
        res.status(404).json({ error: "Note not found." });
        return;
      }

      if (!client) {
        res.status(400).json({ error: "OPENAI_API_KEY is not configured." });
        return;
      }

      const concepts = await readJson(conceptsPath, []);
      const previousConcepts = concepts.filter((concept) => concept.noteId === note.id);
      const extracted = await extractConceptsFromNote(note, client, previousConcepts);
      const preserved = concepts.filter((concept) => concept.noteId !== note.id);
      const merged = [...preserved, ...extracted];
      const mapData = await readJson(mapPath, createEmptyMap());
      const normalizedMap = normalizeMapData(mapData, merged);
      const relations = await generateConceptRelationsSafely(merged, extracted, client);
      const updatedMap = addLlmConnections(normalizedMap, relations, merged);
      await writeJson(conceptsPath, merged);
      await writeJson(mapPath, updatedMap);

      res.json({ concepts: extracted });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/map/nodes/:conceptId", async (req, res, next) => {
    try {
      const concepts = await readJson(conceptsPath, []);
      const concept = concepts.find((entry) => entry.id === req.params.conceptId);

      if (!concept) {
        res.status(404).json({ error: "Concept not found." });
        return;
      }

      const position = sanitizeNodePosition(req.body);
      const mapData = normalizeMapData(
        await readJson(mapPath, createEmptyMap()),
        concepts
      );
      const node = upsertMapNode(mapData, concept.id, position);
      await writeJson(mapPath, mapData);
      res.json(node);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/map/connections", async (req, res, next) => {
    try {
      const concepts = await readJson(conceptsPath, []);
      const mapData = normalizeMapData(
        await readJson(mapPath, createEmptyMap()),
        concepts
      );
      const connection = upsertManualConnection(mapData, req.body, concepts);
      await writeJson(mapPath, mapData);
      res.json(connection);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/map/connections/:connectionId", async (req, res, next) => {
    try {
      const concepts = await readJson(conceptsPath, []);
      const mapData = normalizeMapData(
        await readJson(mapPath, createEmptyMap()),
        concepts
      );
      const originalLength = mapData.connections.length;
      mapData.connections = mapData.connections.filter(
        (connection) => connection.id !== req.params.connectionId
      );

      if (mapData.connections.length === originalLength) {
        res.status(404).json({ error: "Connection not found." });
        return;
      }

      await writeJson(mapPath, mapData);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/map/rebuild", async (_req, res, next) => {
    try {
      if (!client) {
        res.status(400).json({ error: "OPENAI_API_KEY is not configured." });
        return;
      }

      const concepts = await readJson(conceptsPath, []);
      const mapData = normalizeMapData(
        await readJson(mapPath, createEmptyMap()),
        concepts
      );
      const relations = await generateConceptRelations(concepts, concepts, client);
      const rebuiltMap = {
        nodes: mapData.nodes,
        connections: []
      };
      const updatedMap = addLlmConnections(rebuiltMap, relations, concepts);
      await writeJson(mapPath, updatedMap);
      res.json({ concepts, ...updatedMap });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/quizzes/generate", async (req, res, next) => {
    try {
      const concepts = await readJson(conceptsPath, []);
      const notes = await readJson(notesPath, []);
      const quizzes = await readJson(quizzesPath, []);
      const request = sanitizeQuizGenerationRequest(req.body);
      const scopedConcepts = request.noteId
        ? concepts.filter((concept) => concept.noteId === request.noteId)
        : concepts;

      if (!scopedConcepts.length) {
        res.status(400).json({ error: "No concepts are available for quiz generation." });
        return;
      }

      const selectedConcepts = selectQuizConcepts(scopedConcepts, request.count);
      const items = client
        ? await generateQuizItems(selectedConcepts, client)
        : createFallbackQuizItems(selectedConcepts);
      const quiz = buildQuizSession({
        request,
        selectedConcepts,
        items,
        notes
      });

      quizzes.push(quiz);
      await writeJson(quizzesPath, sortQuizzes(quizzes));

      res.json(quiz);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/quizzes/:quizId/submit", async (req, res, next) => {
    try {
      const concepts = await readJson(conceptsPath, []);
      const quizzes = await readJson(quizzesPath, []);
      const quizIndex = quizzes.findIndex((entry) => entry.id === req.params.quizId);

      if (quizIndex < 0) {
        res.status(404).json({ error: "Quiz not found." });
        return;
      }

      if (quizzes[quizIndex].status === "completed") {
        res.status(400).json({ error: "Quiz has already been submitted." });
        return;
      }

      const submission = sanitizeQuizSubmission(quizzes[quizIndex], req.body);
      const updatedConcepts = applyQuizResults(concepts, quizzes[quizIndex], submission);
      const completedQuiz = {
        ...quizzes[quizIndex],
        status: "completed",
        completedAt: submission.completedAt,
        updatedAt: submission.completedAt,
        responses: submission.responses
      };

      quizzes[quizIndex] = completedQuiz;
      await writeJson(conceptsPath, updatedConcepts);
      await writeJson(quizzesPath, sortQuizzes(quizzes));

      res.json({ quiz: completedQuiz, concepts: updatedConcepts });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    const status = error.statusCode || 500;
    res.status(status).json({
      error: error.message || "Unexpected server error."
    });
  });

  return app;
}

async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  await ensureJsonFile(notesPath, [], path.join(legacyDataDir, "notes.json"));
  await ensureJsonFile(directoriesPath, [], path.join(legacyDataDir, "directories.json"));
  await ensureJsonFile(conceptsPath, [], path.join(legacyDataDir, "concepts.json"));
  await ensureJsonFile(quizzesPath, [], path.join(legacyDataDir, "quizzes.json"));
  await ensureJsonFile(mapPath, createEmptyMap(), path.join(legacyDataDir, "map.json"));
}

async function ensureJsonFile(targetPath, fallback, legacyPath = null) {
  try {
    await fs.access(targetPath);
  } catch {
    if (legacyPath) {
      const legacyValue = await readJson(legacyPath, null);

      if (legacyValue !== null) {
        await writeJson(targetPath, legacyValue);
        return;
      }
    }

    await writeJson(targetPath, fallback);
  }
}

async function readJson(targetPath, fallback) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function writeJson(targetPath, value) {
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveDataDir() {
  if (process.env.PROBE_DATA_DIR) {
    return path.resolve(process.env.PROBE_DATA_DIR);
  }

  if (process.env.NODE_ENV === "test") {
    return legacyDataDir;
  }

  return path.join(os.homedir(), ".probe");
}

function sanitizeNote(payload, directories = []) {
  const note = payload && typeof payload === "object" ? payload : {};
  const title = typeof note.title === "string" ? note.title.trim() : "";
  const content = typeof note.content === "string" ? note.content.trim() : "";
  const sanitized = {
    id: typeof note.id === "string" && note.id ? note.id : "",
    title,
    content
  };

  if (!content) {
    const error = new Error("Note content is required.");
    error.statusCode = 400;
    throw error;
  }

  if (Object.hasOwn(note, "directoryId")) {
    sanitized.directoryId = sanitizeDirectoryTarget(note.directoryId, directories);
  }

  return sanitized;
}

function upsertNote(notes, payload, directories = []) {
  const note = sanitizeNote(payload, directories);
  const now = new Date().toISOString();
  const existingIndex = notes.findIndex((entry) => entry.id === note.id);
  const directoryPatch = Object.hasOwn(note, "directoryId")
    ? { directoryId: note.directoryId }
    : {};
  const savedNote =
    existingIndex >= 0
      ? {
          ...notes[existingIndex],
          ...note,
          ...directoryPatch,
          updatedAt: now
        }
      : {
          id: note.id || createId("note"),
          title: note.title || deriveTitle(note.content),
          content: note.content,
          directoryId: note.directoryId || null,
          createdAt: now,
          updatedAt: now
        };

  if (existingIndex >= 0) {
    notes[existingIndex] = savedNote;
  } else {
    notes.push(savedNote);
  }

  return savedNote;
}

function moveNote(notes, noteId, payload, directories = []) {
  const noteIndex = notes.findIndex((entry) => entry.id === noteId);

  if (noteIndex < 0) {
    const error = new Error("Note not found.");
    error.statusCode = 404;
    throw error;
  }

  const targetDirectoryId = sanitizeDirectoryTarget(
    payload && typeof payload === "object" ? payload.directoryId : null,
    directories
  );
  const movedNote = {
    ...notes[noteIndex],
    directoryId: targetDirectoryId,
    updatedAt: new Date().toISOString()
  };
  notes[noteIndex] = movedNote;
  return movedNote;
}

function normalizeDirectories(directories) {
  if (!Array.isArray(directories)) {
    return [];
  }

  const now = new Date().toISOString();
  const byId = new Map();

  for (const directory of directories) {
    if (!directory || typeof directory !== "object" || typeof directory.id !== "string") {
      continue;
    }

    const name = typeof directory.name === "string" ? directory.name.trim() : "";

    if (!name || byId.has(directory.id)) {
      continue;
    }

    byId.set(directory.id, {
      id: directory.id,
      name,
      parentId:
        typeof directory.parentId === "string" && directory.parentId
          ? directory.parentId
          : null,
      createdAt: typeof directory.createdAt === "string" ? directory.createdAt : now,
      updatedAt: typeof directory.updatedAt === "string" ? directory.updatedAt : now
    });
  }

  const normalized = [...byId.values()];

  for (const directory of normalized) {
    if (!directory.parentId || !byId.has(directory.parentId) || directory.parentId === directory.id) {
      directory.parentId = null;
      continue;
    }

    if (isDescendantDirectory(normalized, directory.parentId, directory.id)) {
      directory.parentId = null;
    }
  }

  return normalized;
}

function createDirectory(directories, payload) {
  const directory = sanitizeDirectoryPayload(payload, directories);
  const now = new Date().toISOString();
  const savedDirectory = {
    id: createId("dir"),
    name: directory.name,
    parentId: directory.parentId,
    createdAt: now,
    updatedAt: now
  };
  directories.push(savedDirectory);
  return savedDirectory;
}

function updateDirectory(directories, directoryId, payload) {
  const directoryIndex = directories.findIndex((entry) => entry.id === directoryId);

  if (directoryIndex < 0) {
    const error = new Error("Directory not found.");
    error.statusCode = 404;
    throw error;
  }

  const name =
    payload && typeof payload === "object" && typeof payload.name === "string"
      ? payload.name.trim()
      : "";

  if (!name) {
    const error = new Error("Directory name is required.");
    error.statusCode = 400;
    throw error;
  }

  const updatedDirectory = {
    ...directories[directoryIndex],
    name,
    updatedAt: new Date().toISOString()
  };
  directories[directoryIndex] = updatedDirectory;
  return updatedDirectory;
}

function moveDirectory(directories, directoryId, payload) {
  const directoryIndex = directories.findIndex((entry) => entry.id === directoryId);

  if (directoryIndex < 0) {
    const error = new Error("Directory not found.");
    error.statusCode = 404;
    throw error;
  }

  const parentId = sanitizeDirectoryTarget(
    payload && typeof payload === "object" ? payload.parentId : null,
    directories
  );

  if (parentId === directoryId || isDescendantDirectory(directories, parentId, directoryId)) {
    const error = new Error("A directory cannot be moved into itself or one of its children.");
    error.statusCode = 400;
    throw error;
  }

  const movedDirectory = {
    ...directories[directoryIndex],
    parentId,
    updatedAt: new Date().toISOString()
  };
  directories[directoryIndex] = movedDirectory;
  return movedDirectory;
}

function deleteDirectory(directories, notes, directoryId) {
  const directoryIndex = directories.findIndex((entry) => entry.id === directoryId);

  if (directoryIndex < 0) {
    const error = new Error("Directory not found.");
    error.statusCode = 404;
    throw error;
  }

  const directory = directories[directoryIndex];
  const now = new Date().toISOString();
  directories.splice(directoryIndex, 1);

  for (const child of directories) {
    if (child.parentId === directoryId) {
      child.parentId = directory.parentId;
      child.updatedAt = now;
    }
  }

  for (const note of notes) {
    if (note.directoryId === directoryId) {
      note.directoryId = directory.parentId;
      note.updatedAt = now;
    }
  }
}

function sanitizeDirectoryPayload(payload, directories) {
  const directory = payload && typeof payload === "object" ? payload : {};
  const name = typeof directory.name === "string" ? directory.name.trim() : "";

  if (!name) {
    const error = new Error("Directory name is required.");
    error.statusCode = 400;
    throw error;
  }

  return {
    name,
    parentId: sanitizeDirectoryTarget(directory.parentId, directories)
  };
}

function sanitizeDirectoryTarget(directoryId, directories) {
  if (directoryId === null || directoryId === undefined || directoryId === "") {
    return null;
  }

  if (typeof directoryId !== "string") {
    const error = new Error("Directory id must be a string.");
    error.statusCode = 400;
    throw error;
  }

  if (!directories.some((directory) => directory.id === directoryId)) {
    const error = new Error("Directory not found.");
    error.statusCode = 400;
    throw error;
  }

  return directoryId;
}

function isDescendantDirectory(directories, possibleDescendantId, ancestorId) {
  if (!possibleDescendantId) {
    return false;
  }

  const byId = new Map(directories.map((directory) => [directory.id, directory]));
  let cursor = byId.get(possibleDescendantId);
  const visited = new Set();

  while (cursor) {
    if (cursor.id === ancestorId) {
      return true;
    }

    if (!cursor.parentId || visited.has(cursor.id)) {
      return false;
    }

    visited.add(cursor.id);
    cursor = byId.get(cursor.parentId);
  }

  return false;
}

function deriveTitle(content) {
  return content.split("\n").find(Boolean)?.slice(0, 48) || "Untitled note";
}

function sortNotes(notes) {
  return [...notes].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

function sortDirectories(directories) {
  return [...directories].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
}

function sortQuizzes(quizzes) {
  return [...quizzes].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

async function extractConceptsFromNote(note, apiClient, previousConcepts = []) {
  const response = await apiClient.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Extract durable study concepts from the note. Return strict JSON with keys category and concepts. category must be one of memorization, engineering, social_science, general. concepts must be an array of up to 8 objects with name, summary, sourceSpan, confidenceScore, recallCount, lastReviewedAt."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Note title: ${note.title}\n\nNote content:\n${note.content}`
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "concept_extraction",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["category", "concepts"],
          properties: {
            category: {
              type: "string",
              enum: categoryOptions
            },
            concepts: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "name",
                  "summary",
                  "sourceSpan",
                  "confidenceScore",
                  "recallCount",
                  "lastReviewedAt"
                ],
                properties: {
                  name: { type: "string" },
                  summary: { type: "string" },
                  sourceSpan: { type: "string" },
                  confidenceScore: { type: "number" },
                  recallCount: { type: "integer" },
                  lastReviewedAt: {
                    anyOf: [{ type: "string" }, { type: "null" }]
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  const payload = JSON.parse(response.output_text);
  validateExtractionPayload(payload);

  const previousByName = new Map(
    previousConcepts.map((concept) => [normalizeConceptName(concept.name), concept])
  );

  return payload.concepts.map((concept) => {
    const previous = previousByName.get(normalizeConceptName(concept.name));

    return {
      id: previous?.id || createId("concept"),
      noteId: note.id,
      name: concept.name.trim(),
      category: payload.category,
      summary: concept.summary.trim(),
      sourceSpan: concept.sourceSpan.trim(),
      confidenceScore:
        typeof previous?.confidenceScore === "number"
          ? previous.confidenceScore
          : clampNumber(concept.confidenceScore, 0, 1),
      recallCount:
        previous?.recallCount === undefined
          ? Math.max(0, Number.parseInt(concept.recallCount, 10) || 0)
          : Math.max(0, Number.parseInt(previous.recallCount, 10) || 0),
      lastReviewedAt: previous?.lastReviewedAt || concept.lastReviewedAt || null
    };
  });
}

async function generateConceptRelations(concepts, targetConcepts, apiClient) {
  if (!concepts.length || targetConcepts.length < 1 || concepts.length < 2) {
    return [];
  }

  const response = await apiClient.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Build concept graph relationships. Return strict JSON with a relations array. Relations are undirected. Only include meaningful conceptual relationships. Strength must be an integer from 1 to 5, where 5 is strongest. Every relation must include at least one target conceptId."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(
              {
                targetConceptIds: targetConcepts.map((concept) => concept.id),
                concepts: concepts.map((concept) => ({
                  id: concept.id,
                  name: concept.name,
                  category: concept.category,
                  summary: concept.summary,
                  sourceSpan: concept.sourceSpan
                }))
              },
              null,
              2
            )
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "concept_relations",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["relations"],
          properties: {
            relations: {
              type: "array",
              maxItems: 24,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["sourceConceptId", "targetConceptId", "strength"],
                properties: {
                  sourceConceptId: { type: "string" },
                  targetConceptId: { type: "string" },
                  strength: { type: "integer", minimum: 1, maximum: 5 }
                }
              }
            }
          }
        }
      }
    }
  });

  const payload = JSON.parse(response.output_text);
  validateRelationsPayload(payload, concepts, targetConcepts);
  return sanitizeConceptRelations(payload.relations, concepts, targetConcepts);
}

async function generateConceptRelationsSafely(concepts, targetConcepts, apiClient) {
  try {
    return await generateConceptRelations(concepts, targetConcepts, apiClient);
  } catch (error) {
    console.warn(`Skipping concept relationship generation: ${error.message}`);
    return [];
  }
}

function createEmptyMap() {
  return { nodes: [], connections: [] };
}

function normalizeMapData(mapData, concepts) {
  const conceptIds = new Set(concepts.map((concept) => concept.id));
  const seenNodeIds = new Set();
  const nodes = [];

  for (const node of Array.isArray(mapData?.nodes) ? mapData.nodes : []) {
    if (
      !node ||
      !conceptIds.has(node.conceptId) ||
      seenNodeIds.has(node.conceptId) ||
      !Number.isFinite(node.x) ||
      !Number.isFinite(node.y)
    ) {
      continue;
    }

    seenNodeIds.add(node.conceptId);
    nodes.push({
      conceptId: node.conceptId,
      x: node.x,
      y: node.y,
      updatedAt: typeof node.updatedAt === "string" ? node.updatedAt : new Date().toISOString()
    });
  }

  const seenConnectionKeys = new Set();
  const connections = [];

  for (const connection of Array.isArray(mapData?.connections) ? mapData.connections : []) {
    if (
      !connection ||
      !conceptIds.has(connection.sourceConceptId) ||
      !conceptIds.has(connection.targetConceptId) ||
      connection.sourceConceptId === connection.targetConceptId
    ) {
      continue;
    }

    const key = connectionKey(connection.sourceConceptId, connection.targetConceptId);
    if (seenConnectionKeys.has(key)) {
      continue;
    }

    const [sourceConceptId, targetConceptId] = sortedConceptPair(
      connection.sourceConceptId,
      connection.targetConceptId
    );
    seenConnectionKeys.add(key);
    connections.push({
      id: typeof connection.id === "string" && connection.id ? connection.id : createId("connection"),
      sourceConceptId,
      targetConceptId,
      strength: clampInteger(connection.strength, 1, 5, 3),
      origin: connection.origin === "manual" ? "manual" : "llm",
      createdAt:
        typeof connection.createdAt === "string"
          ? connection.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof connection.updatedAt === "string"
          ? connection.updatedAt
          : new Date().toISOString()
    });
  }

  return { nodes, connections };
}

function sanitizeNodePosition(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const x = Number(body.x);
  const y = Number(body.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    const error = new Error("Map node position requires numeric x and y.");
    error.statusCode = 400;
    throw error;
  }

  return {
    x: clampNumber(x, 0, 4000),
    y: clampNumber(y, 0, 4000)
  };
}

function upsertMapNode(mapData, conceptId, position) {
  const now = new Date().toISOString();
  const node = {
    conceptId,
    x: position.x,
    y: position.y,
    updatedAt: now
  };
  const existingIndex = mapData.nodes.findIndex((entry) => entry.conceptId === conceptId);

  if (existingIndex >= 0) {
    mapData.nodes[existingIndex] = node;
  } else {
    mapData.nodes.push(node);
  }

  return node;
}

function upsertManualConnection(mapData, payload, concepts) {
  const connection = sanitizeConnectionPayload(payload, concepts);
  const now = new Date().toISOString();
  const key = connectionKey(connection.sourceConceptId, connection.targetConceptId);
  const existingIndex = mapData.connections.findIndex(
    (entry) => connectionKey(entry.sourceConceptId, entry.targetConceptId) === key
  );
  const savedConnection = {
    id:
      existingIndex >= 0
        ? mapData.connections[existingIndex].id
        : createId("connection"),
    sourceConceptId: connection.sourceConceptId,
    targetConceptId: connection.targetConceptId,
    strength: connection.strength,
    origin: "manual",
    createdAt:
      existingIndex >= 0
        ? mapData.connections[existingIndex].createdAt
        : now,
    updatedAt: now
  };

  if (existingIndex >= 0) {
    mapData.connections[existingIndex] = savedConnection;
  } else {
    mapData.connections.push(savedConnection);
  }

  return savedConnection;
}

function sanitizeConnectionPayload(payload, concepts) {
  const body = payload && typeof payload === "object" ? payload : {};
  const conceptIds = new Set(concepts.map((concept) => concept.id));
  const sourceId = typeof body.sourceConceptId === "string" ? body.sourceConceptId : "";
  const targetId = typeof body.targetConceptId === "string" ? body.targetConceptId : "";

  if (!conceptIds.has(sourceId) || !conceptIds.has(targetId) || sourceId === targetId) {
    const error = new Error("Connection requires two different known concepts.");
    error.statusCode = 400;
    throw error;
  }

  const [sourceConceptId, targetConceptId] = sortedConceptPair(sourceId, targetId);
  return {
    sourceConceptId,
    targetConceptId,
    strength: clampInteger(body.strength, 1, 5, 3)
  };
}

function addLlmConnections(mapData, relations, concepts) {
  const conceptIds = new Set(concepts.map((concept) => concept.id));
  const existingKeys = new Set(
    mapData.connections.map((connection) =>
      connectionKey(connection.sourceConceptId, connection.targetConceptId)
    )
  );

  for (const relation of relations) {
    if (
      !conceptIds.has(relation.sourceConceptId) ||
      !conceptIds.has(relation.targetConceptId) ||
      relation.sourceConceptId === relation.targetConceptId
    ) {
      continue;
    }

    const key = connectionKey(relation.sourceConceptId, relation.targetConceptId);
    if (existingKeys.has(key)) {
      continue;
    }

    const now = new Date().toISOString();
    const [sourceConceptId, targetConceptId] = sortedConceptPair(
      relation.sourceConceptId,
      relation.targetConceptId
    );
    mapData.connections.push({
      id: createId("connection"),
      sourceConceptId,
      targetConceptId,
      strength: clampInteger(relation.strength, 1, 5, 3),
      origin: "llm",
      createdAt: now,
      updatedAt: now
    });
    existingKeys.add(key);
  }

  return mapData;
}

function validateRelationsPayload(payload, concepts, targetConcepts) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.relations)) {
    throw new Error("OpenAI returned an invalid concept relationship payload.");
  }

  const validRelations = sanitizeConceptRelations(payload.relations, concepts, targetConcepts);

  if (payload.relations.length > 0 && validRelations.length === 0) {
    throw new Error("OpenAI returned no usable concept relationships.");
  }
}

function sanitizeConceptRelations(relations, concepts, targetConcepts) {
  const conceptIds = new Set(concepts.map((concept) => concept.id));
  const targetConceptIds = new Set(targetConcepts.map((concept) => concept.id));
  const seenKeys = new Set();
  const sanitized = [];

  for (const relation of relations) {
    if (
      !relation ||
      typeof relation.sourceConceptId !== "string" ||
      typeof relation.targetConceptId !== "string" ||
      !conceptIds.has(relation.sourceConceptId) ||
      !conceptIds.has(relation.targetConceptId) ||
      relation.sourceConceptId === relation.targetConceptId ||
      (
        !targetConceptIds.has(relation.sourceConceptId) &&
        !targetConceptIds.has(relation.targetConceptId)
      )
    ) {
      continue;
    }

    const key = connectionKey(relation.sourceConceptId, relation.targetConceptId);
    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    sanitized.push({
      sourceConceptId: relation.sourceConceptId,
      targetConceptId: relation.targetConceptId,
      strength: clampInteger(relation.strength, 1, 5, 3)
    });
  }

  return sanitized;
}

function normalizeConceptName(value) {
  return String(value || "").trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function sortedConceptPair(leftId, rightId) {
  return [leftId, rightId].sort();
}

function connectionKey(leftId, rightId) {
  return sortedConceptPair(leftId, rightId).join("::");
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number.parseInt(value, 10);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function sanitizeQuizGenerationRequest(payload) {
  const request = payload && typeof payload === "object" ? payload : {};
  const requestedCount = Number.parseInt(request.count, 10);

  return {
    noteId: typeof request.noteId === "string" && request.noteId ? request.noteId : null,
    count: Number.isFinite(requestedCount)
      ? Math.min(8, Math.max(1, requestedCount))
      : 5
  };
}

function selectQuizConcepts(concepts, count, now = new Date()) {
  return [...concepts]
    .map((concept) => ({
      ...concept,
      effectiveConfidence: computeDecayedConfidence(concept, now),
      priorityScore: computeQuizPriority(concept, now)
    }))
    .sort((left, right) => {
      if (left.priorityScore !== right.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }

      const leftReviewed = left.lastReviewedAt || "";
      const rightReviewed = right.lastReviewedAt || "";
      return leftReviewed.localeCompare(rightReviewed);
    })
    .slice(0, count);
}

function computeQuizPriority(concept, now = new Date()) {
  const effectiveConfidence = computeDecayedConfidence(concept, now);
  const recallCount = Math.max(0, Number.parseInt(concept.recallCount, 10) || 0);
  const lowConfidenceWeight = 1 - effectiveConfidence;
  const recallWeight = 1 / (1 + recallCount);
  const volatilityWeight = Math.abs(
    clampNumber(concept.confidenceScore, 0, 1) - effectiveConfidence
  );

  return lowConfidenceWeight * 0.6 + recallWeight * 0.25 + volatilityWeight * 0.15;
}

function computeDecayedConfidence(concept, now = new Date()) {
  const baseConfidence = clampNumber(concept.confidenceScore, 0, 1);

  if (!concept.lastReviewedAt) {
    return baseConfidence;
  }

  const reviewedAt = new Date(concept.lastReviewedAt);

  if (Number.isNaN(reviewedAt.getTime())) {
    return baseConfidence;
  }

  const elapsedDays = Math.max(
    0,
    (now.getTime() - reviewedAt.getTime()) / (1000 * 60 * 60 * 24)
  );
  const recallCount = Math.max(0, Number.parseInt(concept.recallCount, 10) || 0);
  const decayRate = Math.max(0.035, 0.16 - Math.min(recallCount, 8) * 0.014);
  return clampNumber(baseConfidence * Math.exp(-elapsedDays * decayRate), 0, 1);
}

async function generateQuizItems(concepts, apiClient) {
  const response = await apiClient.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Generate a study quiz from the supplied concepts. Return strict JSON with an items array. Each item must target exactly one provided conceptId. Match quiz style to the concept category. engineering should favor applied or calculation-oriented prompts. memorization should favor recall prompts. social_science should favor explanation or reflection prompts. general should favor explanation and application."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(
              {
                concepts: concepts.map((concept) => ({
                  id: concept.id,
                  name: concept.name,
                  category: concept.category,
                  summary: concept.summary,
                  sourceSpan: concept.sourceSpan,
                  confidenceScore: concept.confidenceScore,
                  effectiveConfidence: concept.effectiveConfidence
                }))
              },
              null,
              2
            )
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "quiz_generation",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          properties: {
            items: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["conceptId", "questionType", "prompt", "answer", "rubric"],
                properties: {
                  conceptId: { type: "string" },
                  questionType: {
                    type: "string",
                    enum: ["flashcard", "explanation", "application", "reflection"]
                  },
                  prompt: { type: "string" },
                  answer: { type: "string" },
                  rubric: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  });

  const payload = JSON.parse(response.output_text);
  validateQuizPayload(payload, concepts);

  return payload.items.map((item) => ({
    id: createId("quiz_item"),
    conceptId: item.conceptId,
    questionType: item.questionType,
    prompt: item.prompt.trim(),
    answer: item.answer.trim(),
    rubric: item.rubric.trim()
  }));
}

function createFallbackQuizItems(concepts) {
  return concepts.map((concept) => {
    const questionType = fallbackQuestionType(concept.category);
    return {
      id: createId("quiz_item"),
      conceptId: concept.id,
      questionType,
      prompt: fallbackPrompt(concept, questionType),
      answer: concept.summary,
      rubric: `Strong answers should accurately explain ${concept.name} and connect back to: ${concept.sourceSpan}`
    };
  });
}

function fallbackQuestionType(category) {
  switch (category) {
    case "engineering":
      return "application";
    case "social_science":
      return "reflection";
    case "memorization":
      return "flashcard";
    default:
      return "explanation";
  }
}

function fallbackPrompt(concept, questionType) {
  switch (questionType) {
    case "application":
      return `Apply ${concept.name} to a concrete example or calculation scenario. Explain each step.`;
    case "reflection":
      return `Write a short paragraph explaining why ${concept.name} matters and what insight it gives you.`;
    case "flashcard":
      return `State the key definition, formula, or fact behind ${concept.name}.`;
    default:
      return `Explain ${concept.name} in your own words and relate it to the original note.`;
  }
}

function buildQuizSession({ request, selectedConcepts, items, notes }) {
  const now = new Date().toISOString();
  const note = request.noteId
    ? notes.find((entry) => entry.id === request.noteId) || null
    : null;

  return {
    id: createId("quiz"),
    noteId: request.noteId,
    noteTitle: note?.title || null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    status: "open",
    conceptIds: selectedConcepts.map((concept) => concept.id),
    items,
    responses: []
  };
}

function sanitizeQuizSubmission(quiz, payload) {
  const body = payload && typeof payload === "object" ? payload : {};

  if (!Array.isArray(body.responses) || !body.responses.length) {
    const error = new Error("Quiz submission must include responses.");
    error.statusCode = 400;
    throw error;
  }

  const itemIds = new Set(quiz.items.map((item) => item.id));
  const completedAt = new Date().toISOString();
  const responses = body.responses.map((response) => {
    const itemId = typeof response?.itemId === "string" ? response.itemId : "";
    const answerText =
      typeof response?.answerText === "string" ? response.answerText.trim() : "";
    const selfRating = Number.parseInt(response?.selfRating, 10);

    if (!itemIds.has(itemId)) {
      const error = new Error("Quiz submission included an unknown item.");
      error.statusCode = 400;
      throw error;
    }

    if (!answerText) {
      const error = new Error("Quiz answers cannot be empty.");
      error.statusCode = 400;
      throw error;
    }

    if (!Number.isFinite(selfRating) || selfRating < 1 || selfRating > 5) {
      const error = new Error("Quiz ratings must be between 1 and 5.");
      error.statusCode = 400;
      throw error;
    }

    return {
      itemId,
      answerText,
      selfRating,
      answeredAt: completedAt
    };
  });

  return { completedAt, responses };
}

function applyQuizResults(concepts, quiz, submission) {
  const conceptRatings = new Map();

  for (const response of submission.responses) {
    const item = quiz.items.find((entry) => entry.id === response.itemId);
    const bucket = conceptRatings.get(item.conceptId) || [];
    bucket.push(response.selfRating);
    conceptRatings.set(item.conceptId, bucket);
  }

  return concepts.map((concept) => {
    const ratings = conceptRatings.get(concept.id);

    if (!ratings) {
      return concept;
    }

    const normalizedRating =
      ratings.reduce((total, value) => total + value, 0) / (ratings.length * 5);
    const currentConfidence = computeDecayedConfidence(concept, new Date(submission.completedAt));
    const nextConfidence = clampNumber(
      currentConfidence * 0.35 + normalizedRating * 0.65,
      0,
      1
    );

    return {
      ...concept,
      confidenceScore: nextConfidence,
      recallCount: Math.max(0, Number.parseInt(concept.recallCount, 10) || 0) + 1,
      lastReviewedAt: submission.completedAt
    };
  });
}

function validateExtractionPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("OpenAI returned an invalid concept payload.");
  }

  if (!categoryOptions.includes(payload.category)) {
    throw new Error("OpenAI returned an unsupported concept category.");
  }

  if (!Array.isArray(payload.concepts)) {
    throw new Error("OpenAI returned an invalid concepts array.");
  }

  for (const concept of payload.concepts) {
    if (
      !concept ||
      typeof concept.name !== "string" ||
      typeof concept.summary !== "string" ||
      typeof concept.sourceSpan !== "string"
    ) {
      throw new Error("OpenAI returned a malformed concept item.");
    }
  }
}

function validateQuizPayload(payload, concepts) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
    throw new Error("OpenAI returned an invalid quiz payload.");
  }

  const conceptIds = new Set(concepts.map((concept) => concept.id));

  for (const item of payload.items) {
    if (
      !item ||
      typeof item.conceptId !== "string" ||
      typeof item.questionType !== "string" ||
      typeof item.prompt !== "string" ||
      typeof item.answer !== "string" ||
      typeof item.rubric !== "string" ||
      !conceptIds.has(item.conceptId)
    ) {
      throw new Error("OpenAI returned a malformed quiz item.");
    }
  }
}

function clampNumber(value, min, max) {
  const numeric = typeof value === "number" ? value : 0;
  return Math.min(max, Math.max(min, numeric));
}

export {
  categoryOptions,
  createApp,
  createDirectory,
  deleteDirectory,
  directoriesPath,
  ensureDataFiles,
  computeDecayedConfidence,
  computeQuizPriority,
  createFallbackQuizItems,
  dataDir,
  readJson,
  mapPath,
  moveDirectory,
  moveNote,
  normalizeDirectories,
  normalizeMapData,
  addLlmConnections,
  resolveDataDir,
  sanitizeConceptRelations,
  selectQuizConcepts,
  sortDirectories,
  sortNotes,
  sortQuizzes,
  upsertManualConnection,
  upsertNote,
  validateExtractionPayload,
  validateRelationsPayload,
  validateQuizPayload,
  writeJson
};

if (process.env.NODE_ENV !== "test") {
  await ensureDataFiles();
  const app = createApp();
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.log(`PROBE listening on http://localhost:${port}`);
    console.log(`PROBE data directory: ${dataDir}`);
  });
}
