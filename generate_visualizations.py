#!/usr/bin/env python3
"""
ICD-10 Network Visualization Generator

This script generates interactive network visualizations of ICD-10 medical codes
showing the hierarchical relationships between chapters, sections, and diagnoses.

Usage:
    python generate_visualizations.py

Output:
    - output/icd10_hierarchy.html: Interactive hierarchical tree visualization
    - output/icd10_network.json: Network data for custom visualizations
"""

import json
import os
import csv
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Node:
    """Represents a node in the ICD-10 hierarchy."""
    id: str
    label: str
    title: str
    level: int
    value: int
    group: str
    parent: Optional[str] = None


@dataclass
class Edge:
    """Represents an edge in the ICD-10 network."""
    source: str
    target: str


@dataclass
class NetworkData:
    """Container for network data."""
    nodes: list = field(default_factory=list)
    edges: list = field(default_factory=list)


def load_csv(filepath: str) -> list[dict]:
    """Load data from a CSV file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        return list(reader)


def build_icd10_network(data_dir: str) -> NetworkData:
    """
    Build the ICD-10 network from CSV data files.
    
    The network follows this hierarchy:
    - Root: ICD-10 (level 1)
    - Chapters: 21 main categories (level 2)
    - Sections: Disease groups within chapters (level 3)
    - Root Diagnoses: Base codes like A00, A01 (level 4)
    - Diagnoses: Specific codes like A00.0, A00.1 (level 5)
    """
    network = NetworkData()
    
    # Load data
    chapters = load_csv(os.path.join(data_dir, 'chapters.csv'))
    sections = load_csv(os.path.join(data_dir, 'sections.csv'))
    diagnoses = load_csv(os.path.join(data_dir, 'diagnoses.csv'))
    
    # Add root node
    network.nodes.append({
        'id': 'ICD-10',
        'label': 'ICD-10 Classification',
        'title': 'International Classification of Diseases, 10th Revision',
        'level': 1,
        'value': 50,
        'group': 'root'
    })
    
    # Add chapter nodes
    for chapter in chapters:
        chapter_id = f"chapter_{chapter['chapter_name']}"
        network.nodes.append({
            'id': chapter_id,
            'label': f"Chapter {chapter['chapter_name']}",
            'title': chapter['description'],
            'level': 2,
            'value': 30,
            'group': f"chapter_{chapter['chapter_name']}"
        })
        network.edges.append({
            'from': 'ICD-10',
            'to': chapter_id
        })
    
    # Add section nodes
    section_to_chapter = {}
    for section in sections:
        section_id = section['section_name']
        chapter_id = f"chapter_{section['chapter_name']}"
        section_to_chapter[section_id] = chapter_id
        
        network.nodes.append({
            'id': section_id,
            'label': section['section_name'],
            'title': f"{section['section_name']}: {section['description']}",
            'level': 3,
            'value': 20,
            'group': f"chapter_{section['chapter_name']}"
        })
        network.edges.append({
            'from': chapter_id,
            'to': section_id
        })
    
    # Process diagnoses
    root_diagnoses = set()
    diagnosis_data = {}
    
    for diag in diagnoses:
        if diag['xref_type'] != 'DESC':
            continue
            
        code = diag['diagnosis_name']
        section = diag['section_name']
        
        # Extract root diagnosis (code before the dot)
        root_code = code.split('.')[0] if '.' in code else code
        
        diagnosis_data[code] = {
            'id': code,
            'label': code,
            'title': f"{code}: {diag['text']}",
            'level': 5 if '.' in code else 4,
            'value': 8 if '.' in code else 15,
            'group': f"chapter_{diag['chapter_name']}",
            'section': section,
            'root': root_code
        }
        
        if '.' not in code:
            root_diagnoses.add(code)
    
    # Add root diagnosis nodes
    added_roots = set()
    for code, data in diagnosis_data.items():
        root_code = data['root']
        section = data['section']
        
        if root_code not in added_roots and section in section_to_chapter:
            # Add root diagnosis node
            if root_code in diagnosis_data:
                root_data = diagnosis_data[root_code]
                network.nodes.append({
                    'id': root_code,
                    'label': root_data['label'],
                    'title': root_data['title'],
                    'level': 4,
                    'value': 15,
                    'group': root_data['group']
                })
            else:
                network.nodes.append({
                    'id': root_code,
                    'label': root_code,
                    'title': root_code,
                    'level': 4,
                    'value': 15,
                    'group': data['group']
                })
            
            network.edges.append({
                'from': section,
                'to': root_code
            })
            added_roots.add(root_code)
    
    # Add specific diagnosis nodes (with dots)
    for code, data in diagnosis_data.items():
        if '.' in code:
            root_code = data['root']
            if root_code in added_roots:
                network.nodes.append({
                    'id': code,
                    'label': data['label'],
                    'title': data['title'],
                    'level': 5,
                    'value': 8,
                    'group': data['group']
                })
                network.edges.append({
                    'from': root_code,
                    'to': code
                })
    
    return network


def generate_vis_network_html(network: NetworkData, output_path: str) -> None:
    """
    Generate an interactive HTML visualization using vis-network.
    
    vis-network is the modern successor to vis.js and provides:
    - High performance with WebGL rendering
    - Responsive design
    - Mobile touch support
    - Hierarchical layouts for tree structures
    """
    
    nodes_json = json.dumps(network.nodes, indent=2)
    edges_json = json.dumps(network.edges, indent=2)
    
    html_template = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ICD-10 Network Visualization</title>
    <script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
    <style>
        * {{
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }}
        
        html, body {{
            width: 100%;
            height: 100%;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
        }}
        
        .container {{
            display: flex;
            flex-direction: column;
            height: 100vh;
            width: 100vw;
        }}
        
        header {{
            padding: 1rem 2rem;
            background: rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }}
        
        h1 {{
            font-size: 1.5rem;
            font-weight: 600;
            background: linear-gradient(90deg, #00d4ff, #7c3aed);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }}
        
        .controls {{
            display: flex;
            gap: 1rem;
            align-items: center;
            flex-wrap: wrap;
        }}
        
        button {{
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.2s ease;
        }}
        
        .btn-primary {{
            background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);
            color: white;
        }}
        
        .btn-primary:hover {{
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(124, 58, 237, 0.4);
        }}
        
        .btn-secondary {{
            background: rgba(255, 255, 255, 0.1);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }}
        
        .btn-secondary:hover {{
            background: rgba(255, 255, 255, 0.2);
        }}
        
        select {{
            padding: 0.5rem 1rem;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 0.875rem;
            cursor: pointer;
        }}
        
        select option {{
            background: #16213e;
            color: white;
        }}
        
        #network {{
            flex: 1;
            width: 100%;
            background: transparent;
        }}
        
        .info-panel {{
            position: fixed;
            bottom: 1rem;
            left: 1rem;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(10px);
            padding: 1rem;
            border-radius: 12px;
            max-width: 300px;
            font-size: 0.875rem;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }}
        
        .info-panel h3 {{
            margin-bottom: 0.5rem;
            color: #00d4ff;
        }}
        
        .stats {{
            display: flex;
            gap: 1rem;
            margin-top: 0.5rem;
        }}
        
        .stat {{
            text-align: center;
        }}
        
        .stat-value {{
            font-size: 1.25rem;
            font-weight: 600;
            color: #7c3aed;
        }}
        
        .stat-label {{
            font-size: 0.75rem;
            color: rgba(255, 255, 255, 0.6);
        }}
        
        .legend {{
            position: fixed;
            top: 5rem;
            right: 1rem;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(10px);
            padding: 1rem;
            border-radius: 12px;
            font-size: 0.75rem;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }}
        
        .legend h4 {{
            margin-bottom: 0.5rem;
            color: #00d4ff;
        }}
        
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin: 0.25rem 0;
        }}
        
        .legend-color {{
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }}
        
        @media (max-width: 768px) {{
            header {{
                padding: 0.75rem 1rem;
            }}
            
            h1 {{
                font-size: 1.25rem;
            }}
            
            .info-panel, .legend {{
                max-width: calc(50% - 1.5rem);
                font-size: 0.75rem;
            }}
            
            .legend {{
                top: auto;
                bottom: 1rem;
                right: 1rem;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>ICD-10 Classification Network</h1>
            <div class="controls">
                <select id="layout-select" aria-label="Select layout">
                    <option value="hierarchical">Hierarchical (Tree)</option>
                    <option value="force">Force-Directed</option>
                    <option value="radial">Radial</option>
                </select>
                <button class="btn-secondary" onclick="network.fit()">Fit View</button>
                <button class="btn-primary" onclick="togglePhysics()">Toggle Physics</button>
            </div>
        </header>
        <div id="network"></div>
    </div>
    
    <div class="info-panel">
        <h3>ICD-10 Hierarchy</h3>
        <p>Interactive visualization of medical diagnosis codes organized by chapters, sections, and individual codes.</p>
        <div class="stats">
            <div class="stat">
                <div class="stat-value" id="node-count">0</div>
                <div class="stat-label">Nodes</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="edge-count">0</div>
                <div class="stat-label">Connections</div>
            </div>
        </div>
    </div>
    
    <div class="legend">
        <h4>Legend</h4>
        <div class="legend-item">
            <div class="legend-color" style="background: #e91e63;"></div>
            <span>Root (ICD-10)</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background: #9c27b0;"></div>
            <span>Chapters</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background: #3f51b5;"></div>
            <span>Sections</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background: #00bcd4;"></div>
            <span>Root Codes</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background: #4caf50;"></div>
            <span>Specific Codes</span>
        </div>
    </div>

    <script>
        // Network data
        const nodesData = {nodes_json};
        const edgesData = {edges_json};
        
        // Color mapping for node levels
        const levelColors = {{
            1: '#e91e63',  // Root - Pink
            2: '#9c27b0',  // Chapters - Purple
            3: '#3f51b5',  // Sections - Indigo
            4: '#00bcd4',  // Root diagnoses - Cyan
            5: '#4caf50'   // Specific diagnoses - Green
        }};
        
        // Process nodes with colors and sizes
        const nodes = new vis.DataSet(nodesData.map(node => ({{
            ...node,
            color: {{
                background: levelColors[node.level] || '#607d8b',
                border: levelColors[node.level] || '#607d8b',
                highlight: {{
                    background: '#ffffff',
                    border: levelColors[node.level] || '#607d8b'
                }}
            }},
            font: {{
                color: '#ffffff',
                size: Math.max(12, 20 - node.level * 2)
            }},
            size: node.value
        }})));
        
        const edges = new vis.DataSet(edgesData.map(edge => ({{
            ...edge,
            color: {{
                color: 'rgba(255, 255, 255, 0.3)',
                highlight: '#00d4ff'
            }},
            width: 1
        }})));
        
        // Update stats
        document.getElementById('node-count').textContent = nodes.length;
        document.getElementById('edge-count').textContent = edges.length;
        
        // Network configuration
        const container = document.getElementById('network');
        const data = {{ nodes, edges }};
        
        const hierarchicalOptions = {{
            layout: {{
                hierarchical: {{
                    enabled: true,
                    direction: 'UD',
                    sortMethod: 'directed',
                    levelSeparation: 150,
                    nodeSpacing: 100,
                    treeSpacing: 200
                }}
            }},
            physics: {{
                enabled: false
            }},
            interaction: {{
                hover: true,
                tooltipDelay: 100,
                zoomView: true,
                dragView: true,
                navigationButtons: true
            }},
            nodes: {{
                shape: 'dot',
                borderWidth: 2,
                shadow: true
            }},
            edges: {{
                smooth: {{
                    type: 'cubicBezier',
                    forceDirection: 'vertical'
                }}
            }}
        }};
        
        const forceOptions = {{
            layout: {{
                hierarchical: {{
                    enabled: false
                }}
            }},
            physics: {{
                enabled: true,
                solver: 'forceAtlas2Based',
                forceAtlas2Based: {{
                    gravitationalConstant: -50,
                    centralGravity: 0.01,
                    springLength: 100,
                    springConstant: 0.08
                }},
                stabilization: {{
                    iterations: 200
                }}
            }},
            interaction: {{
                hover: true,
                tooltipDelay: 100,
                zoomView: true,
                dragView: true,
                hideEdgesOnDrag: true,
                navigationButtons: true
            }},
            nodes: {{
                shape: 'dot',
                borderWidth: 2,
                shadow: true
            }},
            edges: {{
                smooth: {{
                    type: 'continuous'
                }}
            }}
        }};
        
        const radialOptions = {{
            layout: {{
                hierarchical: {{
                    enabled: true,
                    direction: 'DU',
                    sortMethod: 'directed',
                    levelSeparation: 200,
                    nodeSpacing: 150,
                    treeSpacing: 250
                }}
            }},
            physics: {{
                enabled: false
            }},
            interaction: {{
                hover: true,
                tooltipDelay: 100,
                zoomView: true,
                dragView: true,
                navigationButtons: true
            }},
            nodes: {{
                shape: 'dot',
                borderWidth: 2,
                shadow: true
            }},
            edges: {{
                smooth: {{
                    type: 'curvedCW',
                    roundness: 0.2
                }}
            }}
        }};
        
        // Initialize network
        let network = new vis.Network(container, data, hierarchicalOptions);
        let physicsEnabled = false;
        
        // Layout switcher
        document.getElementById('layout-select').addEventListener('change', function(e) {{
            const layout = e.target.value;
            let options;
            
            switch(layout) {{
                case 'hierarchical':
                    options = hierarchicalOptions;
                    break;
                case 'force':
                    options = forceOptions;
                    physicsEnabled = true;
                    break;
                case 'radial':
                    options = radialOptions;
                    break;
                default:
                    options = hierarchicalOptions;
            }}
            
            network.setOptions(options);
            
            // Re-fit after layout change
            setTimeout(() => network.fit(), 500);
        }});
        
        // Toggle physics
        function togglePhysics() {{
            physicsEnabled = !physicsEnabled;
            network.setOptions({{ physics: {{ enabled: physicsEnabled }} }});
        }}
        
        // Double-click to focus on node
        network.on('doubleClick', function(params) {{
            if (params.nodes.length > 0) {{
                network.focus(params.nodes[0], {{
                    scale: 1.5,
                    animation: {{
                        duration: 500,
                        easingFunction: 'easeInOutQuad'
                    }}
                }});
            }}
        }});
        
        // Fit network on load
        network.once('stabilized', function() {{
            network.fit();
        }});
    </script>
</body>
</html>
'''
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_template)


def generate_network_json(network: NetworkData, output_path: str) -> None:
    """Export network data as JSON for use with other visualization tools."""
    data = {
        'nodes': network.nodes,
        'edges': network.edges,
        'metadata': {
            'title': 'ICD-10 Classification Network',
            'description': 'Hierarchical network of ICD-10 medical diagnosis codes',
            'node_count': len(network.nodes),
            'edge_count': len(network.edges)
        }
    }
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)


def main():
    """Main entry point for the visualization generator."""
    # Set up paths
    script_dir = Path(__file__).parent
    data_dir = script_dir / 'data'
    output_dir = script_dir / 'output'
    
    # Create output directory
    output_dir.mkdir(exist_ok=True)
    
    print("Building ICD-10 network from data files...")
    network = build_icd10_network(str(data_dir))
    
    print(f"Network contains {len(network.nodes)} nodes and {len(network.edges)} edges")
    
    # Generate visualizations
    print("Generating HTML visualization...")
    generate_vis_network_html(network, str(output_dir / 'icd10_hierarchy.html'))
    
    print("Exporting network data as JSON...")
    generate_network_json(network, str(output_dir / 'icd10_network.json'))
    
    print(f"\nVisualization files generated in: {output_dir}")
    print("  - icd10_hierarchy.html: Interactive network visualization")
    print("  - icd10_network.json: Network data for custom visualizations")


if __name__ == '__main__':
    main()
