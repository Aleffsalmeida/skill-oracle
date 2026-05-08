'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const SKILLS_ROOT = path.join(HOME, '.claude', 'skills');
const INDEX_PATH = path.join(HOME, '.claude', 'skill-index.json');

// Minimal YAML frontmatter parser — no external deps
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// Extract section content by heading (case-insensitive, partial match)
function extractSection(content, headingPattern) {
  const re = new RegExp(`##\\s+${headingPattern}[^\\n]*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i');
  const m = content.match(re);
  return m ? m[1].trim() : '';
}

function listSkillDirs(root) {
  if (!fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(root, e.name))
      .filter(dir => fs.existsSync(path.join(dir, 'SKILL.md')));
  } catch {
    return [];
  }
}

function readSkill(skillDir) {
  const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const fm = parseFrontmatter(content);

  const whenToUse =
    extractSection(content, 'When to Use') ||
    extractSection(content, 'Use When') ||
    extractSection(content, 'When');

  return {
    id: path.basename(skillDir),
    name: fm.name || path.basename(skillDir),
    description: (fm.description || '').slice(0, 350),
    when_to_use: whenToUse.slice(0, 400),
    path: skillDir,
    has_scripts: fs.existsSync(path.join(skillDir, 'scripts')),
    user_invocable: fm['user-invocable'] !== 'false',
    model: fm.model || null,
  };
}

function buildIndex() {
  const skills = [];
  const seen = new Set();

  const roots = [
    { dir: SKILLS_ROOT, excludeNames: new Set(['learned', 'imported']) },
    { dir: path.join(SKILLS_ROOT, 'learned'), excludeNames: new Set() },
    { dir: path.join(SKILLS_ROOT, 'imported'), excludeNames: new Set() },
  ];

  for (const { dir, excludeNames } of roots) {
    for (const skillDir of listSkillDirs(dir)) {
      const id = path.basename(skillDir);
      if (excludeNames.has(id) || seen.has(id)) continue;
      seen.add(id);
      try {
        skills.push(readSkill(skillDir));
      } catch {
        // skip malformed SKILL.md
      }
    }
  }

  const index = {
    generated_at: new Date().toISOString(),
    total: skills.length,
    skills,
  };

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  return index;
}

try {
  const index = buildIndex();
  process.stdout.write(`skill-oracle: indexed ${index.total} skills → ${INDEX_PATH}\n`);
} catch (e) {
  process.stderr.write(`[skill-oracle] build-index error: ${e.message}\n`);
}
process.exit(0);
