import project from './project.json';
import { validateProject } from '../validateProject';
import { assetIds } from '../assets';
import type { GameContent } from '../types';

const errors = validateProject(project, assetIds);
if (errors.length)
  throw new Error(`Invalid game content:\n${errors.join('\n')}`);
// The runtime validator checks JSON shape before it crosses this boundary.
export const content = project as unknown as GameContent;
