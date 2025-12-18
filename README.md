# Citrus Fantasy Sports

A modern fantasy hockey platform built with React, TypeScript, and Supabase.

## Features

- **Draft Room**: Real-time draft experience with drag-and-drop functionality
- **Roster Management**: Add/drop players, manage lineups, and track transactions
- **Matchups**: View weekly matchups with live scoring and player stats
- **Free Agency**: Browse and add available players to your roster
- **League Management**: Create and manage fantasy hockey leagues

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **UI**: Tailwind CSS, Radix UI, shadcn/ui
- **Backend**: Supabase (PostgreSQL, Auth, RLS)
- **Hosting**: Firebase Hosting

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase account and project

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Environment Setup

Ensure your Supabase credentials are configured in `src/integrations/supabase/client.ts`.

## Deployment

The app is deployed to Firebase Hosting:

```bash
# Build and deploy
npm run deploy
```

Live URL: https://citrus-fantasy-sports.web.app

## Project Structure

```
src/
  ├── components/     # Reusable UI components
  ├── pages/         # Page components
  ├── services/      # API and business logic
  ├── integrations/ # Supabase client and types
  └── utils/         # Utility functions
```

## License

Private project - All rights reserved
