import project from './project.json';
import { validateProject } from '../validateProject';
import { animationRegions, assetIds } from '../assets';
import type { GameContent } from '../types';

// A release asset set may be resized; its animation regions follow its pixels.
const regions = animationRegions;
const source = regions
  ? {
      ...project,
      animations: project.animations?.map((animation) =>
        regions[animation.id]
          ? { ...animation, region: regions[animation.id] }
          : animation,
      ),
    }
  : project;
const errors = validateProject(source, assetIds);
if (errors.length)
  throw new Error(`Invalid game content:\n${errors.join('\n')}`);
// The runtime validator checks JSON shape before it crosses this boundary.
export const content = source as unknown as GameContent;
