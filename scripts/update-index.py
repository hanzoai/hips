#!/usr/bin/env python3
"""Update HIP index in README.md based on HIP files."""
import os
import re
from pathlib import Path

def extract_frontmatter(filepath):
    """Extract YAML frontmatter from a markdown file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    if not content.startswith('---'):
        return {}
    end = content.find('\n---', 3)
    if end == -1:
        return {}
    fm_text = content[3:end].strip()
    data = {}
    for line in fm_text.splitlines():
        if ':' in line:
            key, val = line.split(':', 1)
            data[key.strip()] = val.strip().strip('"').strip("'")
    return data

def get_all_hips(directory='HIPs'):
    """Get all HIP files and their metadata."""
    hips = []
    for filename in os.listdir(directory):
        if filename.endswith('.md') and filename.startswith('hip-'):
            filepath = os.path.join(directory, filename)
            fm = extract_frontmatter(filepath)
            match = re.search(r'hip-(\d+)(?:-[a-z0-9-]+)?\.md', filename)
            if match:
                number = int(match.group(1))
                fm['number'] = number
                fm['filename'] = filename
                hips.append(fm)
    hips.sort(key=lambda x: x['number'])
    return hips

def generate_index_table(hips):
    """Generate markdown table for HIPs."""
    lines = [
        "## HIP Index\n",
        "| Number | Title | Type | Category | Status |",
        "|:-------|:------|:-----|:---------|:-------|"
    ]
    for h in hips:
        num = h['number']
        filename = h.get('filename', f'hip-{num:04d}.md')
        title = h.get('title', 'Untitled')
        htype = h.get('type', '-')
        category = h.get('category', '-') or '-'
        status = h.get('status', 'Draft')
        if len(title) > 55:
            title = title[:52] + '...'
        lines.append(f"| [HIP-{num:04d}](./HIPs/{filename}) | {title} | {htype} | {category} | {status} |")
    return '\n'.join(lines)

def update_readme():
    """Update README.md with new index."""
    readme_path = 'README.md'
    with open(readme_path, 'r', encoding='utf-8') as f:
        content = f.read()

    hips = get_all_hips()
    new_index = generate_index_table(hips)

    # Find and replace the HIP Index section
    start_marker = "## HIP Index"
    start_idx = content.find(start_marker)
    if start_idx == -1:
        # Append at end if not found
        content += "\n\n" + new_index
    else:
        # Find next section
        next_section = re.search(r'\n## [^#]', content[start_idx + len(start_marker):])
        if next_section:
            end_idx = start_idx + len(start_marker) + next_section.start()
            content = content[:start_idx] + new_index + "\n\n" + content[end_idx+1:]
        else:
            content = content[:start_idx] + new_index

    with open(readme_path, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"Updated README.md with {len(hips)} HIPs")

if __name__ == '__main__':
    os.chdir(Path(__file__).parent.parent)
    update_readme()
