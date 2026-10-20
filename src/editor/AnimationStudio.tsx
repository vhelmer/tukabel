import type { ComponentProps } from 'react';
import { AnimationPanel } from './AnimationPanel';
import { AnimationDirectionPanel } from './AnimationDirectionPanel';
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
  return (
    <>
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
