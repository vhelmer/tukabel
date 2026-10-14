import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { ImageRegion } from '../game/types';
import { assetUrl } from '../game/assets';
import { Field } from './fields';

export function AnimationRegion({
  source,
  size,
  region,
  onChange,
  disabled,
}: {
  source: string;
  size: { width: number; height: number };
  region?: ImageRegion;
  onChange: (region: ImageRegion | undefined) => void;
  disabled: boolean;
}) {
  const host = useRef<SVGSVGElement>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    bounds: ImageRegion;
  } | null>(null);
  const [preview, setPreview] = useState<ImageRegion>();
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const box = host.current!.getBoundingClientRect();
    return {
      x: Math.round(
        Math.max(
          0,
          Math.min(
            size.width,
            ((event.clientX - box.left) / box.width) * size.width,
          ),
        ),
      ),
      y: Math.round(
        Math.max(
          0,
          Math.min(
            size.height,
            ((event.clientY - box.top) / box.height) * size.height,
          ),
        ),
      ),
    };
  };
  function finish(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    setPreview(undefined);
    if (host.current?.hasPointerCapture(event.pointerId))
      host.current.releasePointerCapture(event.pointerId);
    if (!cancelled && current.bounds.width >= 4 && current.bounds.height >= 4)
      onChange(current.bounds);
  }
  const shown = preview ?? region;
  return (
    <div className="animation-region">
      <p className="field-note">
        Potiahni rámček okolo očí / úst. Súradnice sú pixely zdrojového obrázka,
        nie lokácie. Mimo rámčeka ostanú pôvodné pixely.
      </p>
      <svg
        className="mask-stage"
        ref={host}
        viewBox={`0 0 ${size.width} ${size.height}`}
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
        aria-label="Oblasť AI úpravy"
        onPointerDown={(event) => {
          if (disabled || event.button !== 0 || gesture.current) return;
          const start = point(event);
          host.current?.setPointerCapture(event.pointerId);
          gesture.current = {
            id: event.pointerId,
            ...start,
            bounds: { ...start, width: 0, height: 0 },
          };
          setPreview(gesture.current.bounds);
        }}
        onPointerMove={(event) => {
          const current = gesture.current;
          if (!current || current.id !== event.pointerId) return;
          const end = point(event);
          current.bounds = {
            x: Math.min(current.x, end.x),
            y: Math.min(current.y, end.y),
            width: Math.abs(current.x - end.x),
            height: Math.abs(current.y - end.y),
          };
          setPreview({ ...current.bounds });
        }}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
      >
        <image
          href={assetUrl(source)}
          width={size.width}
          height={size.height}
          pointerEvents="none"
        />
        {shown && (
          <rect
            {...shown}
            fill="#ffca6a33"
            stroke="#ffca6a"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
      </svg>
      <div className="bounds-fields">
        {(['x', 'y', 'width', 'height'] as const).map((key) => (
          <Field label={`Maska ${key}`} key={key}>
            <input
              type="number"
              min={key === 'x' || key === 'y' ? 0 : 4}
              disabled={disabled}
              value={region?.[key] ?? ''}
              onChange={(event) =>
                onChange({
                  ...(region ?? { x: 0, y: 0, width: 4, height: 4 }),
                  [key]: Number(event.target.value),
                })
              }
            />
          </Field>
        ))}
      </div>
      <button disabled={disabled} onClick={() => onChange(undefined)}>
        Zrušiť oblasť
      </button>
    </div>
  );
}
