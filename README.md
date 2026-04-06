# ICD-10 Network Visualization

Interactive visualization of the International Classification of Diseases, 10th Revision (ICD-10) medical diagnosis codes as a hierarchical network.

## Overview

This project visualizes the hierarchical structure of ICD-10 codes, showing the relationships between:
- **Chapters** (21 main categories)
- **Sections** (disease groups within chapters)
- **Root Diagnoses** (base codes like A00, A01)
- **Specific Diagnoses** (detailed codes like A00.0, A00.1)

## Features

- **Interactive Network Visualization**: Explore the ICD-10 hierarchy with zoom, pan, and click interactions
- **Multiple Layout Options**: 
  - Hierarchical (tree structure)
  - Force-directed (physics simulation)
  - Radial layout
- **Responsive Design**: Works on desktop and mobile devices
- **Modern Web Standards**: Built with vis-network 9.x and modern HTML5/CSS3

## Quick Start

### Prerequisites

- Python 3.9+

### Installation

```bash
pip install -r requirements.txt
```

### Generate Visualizations

```bash
python generate_visualizations.py
```

This will create:
- `output/icd10_hierarchy.html` - Interactive HTML visualization
- `output/icd10_network.json` - Network data in JSON format

### View the Visualization

Open `output/icd10_hierarchy.html` in any modern web browser.

## Project Structure

```
ICD-NetworkViz/
├── data/
│   ├── chapters.csv      # ICD-10 chapters
│   ├── sections.csv      # Sections within chapters
│   └── diagnoses.csv     # Individual diagnosis codes
├── output/
│   ├── icd10_hierarchy.html  # Generated visualization
│   └── icd10_network.json    # Network data
├── generate_visualizations.py  # Main script
├── requirements.txt
└── README.md
```

## Customization

### Adding More Data

The visualization is generated from CSV files in the `data/` directory:

- **chapters.csv**: `chapter_name, description`
- **sections.csv**: `section_name, chapter_name, description`
- **diagnoses.csv**: `diagnosis_name, section_name, chapter_name, xref_type, text, refers_to`

### Modifying the Visualization

Edit `generate_visualizations.py` to customize:
- Node colors and sizes (see `levelColors` in the generated HTML)
- Layout options
- Interaction behaviors

## Technologies

- **Python 3.11+**: Data processing and HTML generation
- **vis-network 9.x**: Modern network visualization library (successor to vis.js)
- **HTML5/CSS3**: Responsive, modern web interface

## Original Data Source

The ICD-10 data structure is based on the international standard maintained by the World Health Organization (WHO).

## License

MIT License - see [LICENSE](LICENSE) for details.
