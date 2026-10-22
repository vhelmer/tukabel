import type { ComponentProps } from 'react';
import { AnimationPanel } from './AnimationPanel';
import { AnimationDirectionPanel } from './AnimationDirectionPanel';
import { CodexPanel } from './CodexPanel';
import { artFingerprint } from './jobs';
import type { EditorJob } from './jobs';

type Props = ComponentProps<typeof AnimationPanel> & {
  jobs: readonly EditorJob[];
  selectedJob: string;
  onSubmitted: (job: EditorJob) => void;
  onDismiss: (id: string) => void;
};

// Keep the established import/timeline/speech editor intact. Experimental
// direction lives above it and only proposes changes through its normal callback.
export function AnimationStudio({
  jobs,
  selectedJob,
  onSubmitted,
  onDismiss,
  ...studio
}: Props) {
  const scene = studio.content.scenes.find((s) => s.id === studio.sceneId)!;
  return (
    <>
      <CodexPanel
        locked={studio.hotspot.locked}
        active={studio.active}
        context={{
          mode: 'character',
          sceneId: scene.id,
          targetId: studio.hotspot.id,
          source: studio.hotspot.image!,
          label: studio.hotspot.label,
          fingerprint: artFingerprint(scene, studio.hotspot.id),
          placement: {
            bounds: studio.hotspot.bounds,
            rotation: studio.hotspot.rotation,
            imageFit: studio.hotspot.imageFit,
          },
        }}
        content={studio.content}
        assets={studio.assets}
        jobs={jobs}
        selectedJob={selectedJob}
        onSubmitted={onSubmitted}
        onDismiss={onDismiss}
        onAssets={studio.onAssets}
        onChange={(next) =>
          studio.onCommit(
            next.animations ?? [],
            next.scenes
              .find((s) => s.id === scene.id)!
              .hotspots.find((h) => h.id === studio.hotspot.id)!,
          )
        }
      />
      <AnimationDirectionPanel
        {...studio}
        jobs={jobs}
        selectedJob={selectedJob}
        onSubmitted={onSubmitted}
        onDismiss={onDismiss}
      />
      <AnimationPanel {...studio} />
    </>
  );
}
