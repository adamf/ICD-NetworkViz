# ICD-10 Network Visualization

Interactive visualization of the International Classification of Diseases, 10th Revision (ICD-10) medical diagnosis codes as a hierarchical network.

**[Live Demo](https://adamf.github.io/ICD-NetworkViz/)**

## Overview

This project visualizes the hierarchical structure of ICD-10 codes using D3.js, showing the relationships between:
- **Chapters** (21 main categories)
- **Sections** (disease groups within chapters)
- **Root Diagnoses** (base codes like A00, A01)
- **Specific Diagnoses** (detailed codes like A00.0, A00.1)

## Features

- **Interactive D3.js Visualization**: Explore the ICD-10 hierarchy with zoom, pan, and click interactions
- **Multiple Layout Options**: 
  - Hierarchical Tree (horizontal tree structure)
  - Radial Tree (circular layout)
  - Cluster Dendrogram (clustered hierarchy)
- **Chapter Filtering**: Focus on specific ICD-10 chapters
- **Responsive Design**: Works on desktop and mobile devices
- **Modern Web Standards**: Built with TypeScript, D3.js, and Vite

## Quick Start

### Prerequisites

- Node.js 18+

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Project Structure

```
ICD-NetworkViz/
├── data/
│   ├── chapters.csv      # ICD-10 chapters
│   ├── sections.csv      # Sections within chapters
│   └── diagnoses.csv     # Individual diagnosis codes
├── src/
│   ├── main.ts           # Application entry point
│   ├── data.ts           # Data loading and processing
│   ├── visualization.ts  # D3.js visualization logic
│   ├── types.ts          # TypeScript type definitions
│   └── styles.css        # Application styles
├── .github/
│   └── workflows/
│       └── deploy.yml    # GitHub Pages deployment
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Technologies

- **TypeScript**: Type-safe JavaScript
- **D3.js 7**: Data visualization library
- **Vite**: Fast build tool and dev server
- **GitHub Pages**: Static site hosting

## Deployment

The project automatically deploys to GitHub Pages when changes are pushed to the `main` branch. The deployment workflow:

1. Builds the TypeScript/D3 application
2. Deploys to GitHub Pages

## Original Data Source

The ICD-10 data structure is based on the international standard maintained by the World Health Organization (WHO).

## License

MIT License - see [LICENSE](LICENSE) for details.
