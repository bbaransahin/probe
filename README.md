# PROBE

PROBE is a local note-taking and recall practice app. It stores notes, extracts concepts with the OpenAI API, generates quizzes, tracks confidence, and visualizes concept relationships as a free-form map.

## Requirements

- Node.js 20 or newer
- npm
- An OpenAI API key for concept extraction and quiz generation

## Setup

Install dependencies:

```sh
npm install
```

Create a `.env` file in the project root:

```sh
OPENAI_API_KEY=your_api_key_here
PORT=3000
```

`OPENAI_API_KEY` is optional for browsing existing notes and data, but required for AI-powered extraction, quiz generation, and map rebuilds.

## Development

Start the development server with file watching:

```sh
npm run dev
```

Open the app at `http://localhost:3000`.

Available pages:

- `/` for notes
- `/quizzes` for recall sessions
- `/map` for the concept map

## Scripts

```sh
npm start
npm run dev
npm test
```

## Data

By default, PROBE stores JSON data in the `data/` directory:

- `data/notes.json`
- `data/concepts.json`
- `data/quizzes.json`
- `data/map.json`

Set `PROBE_DATA_DIR` to store runtime data somewhere else:

```sh
PROBE_DATA_DIR=./tmp/probe-data npm run dev
```
