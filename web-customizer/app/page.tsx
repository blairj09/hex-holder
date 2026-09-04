'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Hexagon, Layers3, LoaderCircle, RotateCcw } from 'lucide-react';

import { LiveModelViewer } from '@/components/live-model-viewer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  buildHolderModel,
  depthForStickerCapacity,
  disposeHolderModel,
  INSIDE_WIDTH,
  LID_PLUG_HEIGHT,
  STICKER_CAPACITIES,
  stickerStackHeight,
  type HolderConfig,
  type HolderPart,
  type StickerCapacity,
} from '@/lib/holder-model';

type AppConfig = Omit<HolderConfig, 'depth'> & { stickerCapacity: StickerCapacity; assembled: boolean };
type ModelContextDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: {
        name: string;
        title: string;
        description: string;
        inputSchema: object;
        annotations: object;
        execute: (input: unknown) => unknown;
      },
      options: { signal: AbortSignal },
    ) => void | Promise<void>;
  };
};

function isStickerCapacity(value: unknown): value is StickerCapacity {
  return typeof value === 'number' && STICKER_CAPACITIES.includes(value as StickerCapacity);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function Home() {
  const [stickerCapacity, setStickerCapacity] = useState<StickerCapacity>(50);
  const [cellWidth, setCellWidth] = useState(3.9);
  const [embossed, setEmbossed] = useState(false);
  const [texture, setTexture] = useState(true);
  const [part, setPart] = useState<HolderPart>('both');
  const [assembled, setAssembled] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState('');
  const configRef = useRef<AppConfig>({ stickerCapacity, cellWidth, embossed, texture, part, assembled });

  const depth = depthForStickerCapacity(stickerCapacity);
  const config: HolderConfig = { depth, cellWidth, embossed, texture, part };

  useEffect(() => {
    configRef.current = { stickerCapacity, cellWidth, embossed, texture, part, assembled };
  }, [stickerCapacity, cellWidth, embossed, texture, part, assembled]);

  useEffect(() => {
    const context = (document as ModelContextDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
    const isPart = (value: unknown): value is HolderPart => value === 'body' || value === 'lid' || value === 'both';

    void Promise.resolve(context.registerTool({
      name: 'configure_hex_sticker_holder',
      title: 'Configure hex sticker holder',
      description: 'Set the sticker capacity, honeycomb finish, output parts, and visible arrangement. The inside width is fixed at 46 mm.',
      inputSchema: {
        type: 'object',
        properties: {
          stickerCapacity: { type: 'number', enum: [...STICKER_CAPACITIES], description: 'Number of stickers the holder should fit.' },
          cellWidth: { type: 'number', minimum: 1.8, maximum: 8, description: 'Honeycomb flat-to-flat width in millimetres.' },
          embossed: { type: 'boolean', description: 'Raise the honeycomb cells instead of engraving them.' },
          texture: { type: 'boolean', description: 'Show and export the honeycomb texture.' },
          part: { type: 'string', enum: ['body', 'lid', 'both'] },
          assembled: { type: 'boolean', description: 'Show the lid seated on the holder. This does not affect the print layout.' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuration must be an object.');
        const next = { ...configRef.current, ...(input as Partial<AppConfig>) };
        if (!isStickerCapacity(next.stickerCapacity)) throw new Error('stickerCapacity must be 25, 50, 75, or 100.');
        if (!isNumber(next.cellWidth) || next.cellWidth < 1.8 || next.cellWidth > 8) throw new Error('cellWidth must be between 1.8 and 8 mm.');
        if (typeof next.texture !== 'boolean' || typeof next.embossed !== 'boolean' || typeof next.assembled !== 'boolean' || !isPart(next.part)) {
          throw new Error('The supplied finish or output selection is invalid.');
        }
        if (!next.texture) next.embossed = false;
        if (next.part !== 'both') next.assembled = false;
        setStickerCapacity(next.stickerCapacity);
        setCellWidth(next.cellWidth);
        setEmbossed(next.embossed);
        setTexture(next.texture);
        setPart(next.part);
        setAssembled(next.assembled);
        setStatus('');
        const nextDepth = depthForStickerCapacity(next.stickerCapacity);
        return {
          ...next,
          stickerStackHeight: stickerStackHeight(next.stickerCapacity),
          lidIntrusion: LID_PLUG_HEIGHT,
          interiorDepth: nextDepth,
          insideWidth: INSIDE_WIDTH,
        };
      },
    }, { signal: lifecycle.signal })).catch(console.error);
    return () => lifecycle.abort();
  }, []);

  function choosePart(nextPart: HolderPart) {
    setPart(nextPart);
    if (nextPart !== 'both') setAssembled(false);
    setStatus('');
  }

  function toggleTexture(enabled: boolean) {
    setTexture(enabled);
    if (!enabled) setEmbossed(false);
    setStatus('');
  }

  async function downloadStl() {
    if (isExporting) return;
    setIsExporting(true);
    setStatus('Preparing your STL…');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    let model: ReturnType<typeof buildHolderModel> | null = null;
    try {
      model = buildHolderModel(config, { arrangement: 'print', preview: false });
      // Three.js is Y-up; STL/slicer convention is Z-up.
      model.rotation.x = Math.PI / 2;
      model.updateMatrixWorld(true);
      const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
      const data = new STLExporter().parse(model, { binary: true });
      const triangleCount = data.getUint32(80, true);
      if (triangleCount === 0 || data.byteLength !== 84 + triangleCount * 50) throw new Error('The exported STL is incomplete.');

      const blob = new Blob([data.buffer], { type: 'model/stl' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hex-sticker-holder-${part}-${stickerCapacity}-stickers.stl`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Downloaded ${triangleCount.toLocaleString()} triangles · ${(blob.size / 1024).toFixed(0)} KB`);
    } catch (error) {
      console.error(error);
      setStatus('The STL could not be created. Try a larger honeycomb size.');
    } finally {
      if (model) disposeHolderModel(model);
      setIsExporting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f1f5f6] text-[#102a33]">
      <header className="border-b border-[#d7e1e3] bg-white px-5 py-3 sm:px-7">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-[10px] bg-[#063d4a] text-[#e7ffb1]">
              <Hexagon className="size-5" strokeWidth={2.25} />
            </span>
            <h1 className="text-[15px] font-semibold tracking-tight">Hex Holder</h1>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-4 md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)] lg:px-6 lg:py-6">
        <section className="rounded-2xl border border-[#d7e1e3] bg-white p-5 shadow-[0_8px_28px_rgba(35,74,85,0.06)]">
          <h2 className="mb-5 text-lg font-semibold tracking-tight">Customize</h2>

          <div className="space-y-5">
            <ChoiceGroup
              label="Capacity"
              value={String(stickerCapacity)}
              options={STICKER_CAPACITIES.map((capacity) => [String(capacity), `${capacity} stickers`])}
              onChange={(value) => { setStickerCapacity(Number(value) as StickerCapacity); setStatus(''); }}
            />
            <fieldset className="space-y-4 border-t border-[#e2e9eb] pt-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[#648087]">Surface</legend>
              <ToggleRow id="honeycomb-texture" label="Honeycomb Pattern" checked={texture} onCheckedChange={toggleTexture} />
              {texture && (
                <>
                  <DimensionControl
                  label="Honeycomb size"
                  value={cellWidth}
                  min={1.8}
                  max={8}
                  step={0.1}
                  onChange={(value) => { setCellWidth(value); setStatus(''); }}
                  />
                  <ChoiceGroup
                    label="Style"
                    value={embossed ? 'raised' : 'engraved'}
                    options={[['engraved', 'Engraved'], ['raised', 'Raised']]}
                    onChange={(value) => { setEmbossed(value === 'raised'); setStatus(''); }}
                  />
                </>
              )}
            </fieldset>

            <fieldset className="border-t border-[#e2e9eb] pt-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[#648087]">Export</legend>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {([
                  ['both', 'Body + lid'],
                  ['body', 'Body only'],
                  ['lid', 'Lid only'],
                ] as Array<[HolderPart, string]>).map(([value, label], index) => (
                  <label
                    key={value}
                    className={`relative ${index === 0 ? 'col-span-2' : ''}`}
                  >
                    <input type="radio" name="stl-contents" value={value} checked={part === value} onChange={() => choosePart(value)} className="peer sr-only" />
                    <span className={`block cursor-pointer rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition peer-focus-visible:ring-3 peer-focus-visible:ring-[#0c697a]/30 ${part === value ? 'border-[#0c697a] bg-[#dff5f0] text-[#073f4b]' : 'border-[#cbd9dd] bg-white text-[#52717a] hover:border-[#87a8af]'}`}>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="mt-6 space-y-2">
            <Button type="button" disabled={isExporting} onClick={() => void downloadStl()} className="h-11 w-full bg-[#063d4a] text-white hover:bg-[#0b5867] disabled:bg-[#9bb2b7]">
              {isExporting ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {isExporting ? 'Preparing STL…' : 'Download STL'}
            </Button>
            {status && <output aria-live="polite" className="block text-center text-xs leading-5 text-[#52717a]">{status}</output>}
          </div>
        </section>

        <section className="flex min-h-[540px] flex-col overflow-hidden rounded-2xl bg-[#063d4a] shadow-[0_10px_30px_rgba(6,61,74,0.14)] md:sticky md:top-4 md:h-[calc(100vh-6.5rem)] md:max-h-[740px]">
          <div className="flex items-center justify-between gap-3 border-b border-white/12 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-white">Preview</h2>
            <div className="flex items-center gap-2">
              {part === 'both' && (
                <button type="button" aria-pressed={assembled} onClick={() => setAssembled((value) => !value)} className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition ${assembled ? 'border-[#e7ffb1]/60 bg-[#e7ffb1]/15 text-[#e7ffb1]' : 'border-white/20 bg-white/5 text-[#dff5f0] hover:bg-white/10'}`}>
                  <Layers3 className="size-3.5" /> {assembled ? 'Unassembled' : 'Assembled'}
                </button>
              )}
              <button type="button" onClick={() => setResetToken((value) => value + 1)} aria-label="Reset 3D view" className="grid size-9 place-items-center rounded-lg border border-white/20 bg-white/5 text-[#dff5f0] transition hover:bg-white/10">
                <RotateCcw className="size-4" />
              </button>
            </div>
          </div>

          <div className="h-[500px] min-h-0 md:h-auto md:flex-1">
            <LiveModelViewer {...config} assembled={assembled} resetToken={resetToken} />
          </div>
        </section>
      </section>
    </main>
  );
}

function DimensionControl({ label, detail, value, min, max, step, onChange, disabled = false }: { label: string; detail?: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; disabled?: boolean }) {
  const id = label.toLowerCase().replaceAll(' ', '-');

  return (
    <div className={disabled ? 'opacity-45' : ''}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div><Label htmlFor={id} className="text-sm font-semibold">{label}</Label>{detail && <p className="mt-0.5 text-xs text-[#52717a]">{detail}</p>}</div>
        <div className="relative w-28">
          <Input id={id} type="number" inputMode="decimal" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) onChange(clamp(next, min, max)); }} onBlur={(event) => { event.currentTarget.value = String(value); }} className="h-9 border-[#b9ced3] bg-white pr-9 text-right font-mono text-sm" />
          <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-[#52717a]">mm</span>
        </div>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} disabled={disabled} onValueChange={(values) => { const next = typeof values === 'number' ? values : values[0]; if (Number.isFinite(next)) onChange(next); }} className="[&_[data-slot=slider-range]]:bg-[#0c697a] [&_[data-slot=slider-thumb]]:border-[#0c697a]" />
    </div>
  );
}

function ToggleRow({ id, label, description, checked, onCheckedChange }: { id: string; label: string; description?: string; checked: boolean; onCheckedChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4"><div><Label htmlFor={id} className="cursor-pointer text-sm font-semibold">{label}</Label>{description && <p className="mt-0.5 text-xs text-[#52717a]">{description}</p>}</div><Switch id={id} checked={checked} onCheckedChange={onCheckedChange} className="data-checked:bg-[#0c697a]" /></div>;
}

function ChoiceGroup({ label, detail, value, options, onChange, disabled = false }: { label: string; detail?: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void; disabled?: boolean }) {
  const name = label.toLowerCase().replaceAll(' ', '-');
  return <div className={disabled ? 'opacity-45' : ''}><div className="mb-2"><p className="text-sm font-semibold">{label}</p>{detail && <p className="mt-0.5 text-xs text-[#52717a]">{detail}</p>}</div><div className="grid grid-cols-2 gap-2">{options.map(([option, text]) => <label key={option} className="relative"><input type="radio" name={name} value={option} checked={value === option} disabled={disabled} onChange={() => onChange(option)} className="peer sr-only" /><span className={`block cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-medium transition peer-focus-visible:ring-3 peer-focus-visible:ring-[#0c697a]/30 ${value === option ? 'border-[#0c697a] bg-[#dff5f0] text-[#073f4b]' : 'border-[#cbd9dd] bg-white text-[#52717a] hover:border-[#87a8af]'} peer-disabled:cursor-not-allowed`}>{text}</span></label>)}</div></div>;
}
