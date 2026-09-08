'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Hexagon, Images, Layers3, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react';

import { LiveModelViewer } from '@/components/live-model-viewer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  buildHolderModel,
  depthForStickerCapacity,
  disposeHolderModel,
  hasFilledSvgShape,
  INSIDE_WIDTH,
  isComplexSvgForPrint,
  LID_PLUG_HEIGHT,
  makePrintableExportModel,
  makeLogoModifierExportModel,
  STICKER_CAPACITIES,
  stickerStackHeight,
  type HolderConfig,
  type HolderPart,
  type StickerCapacity,
} from '@/lib/holder-model';

type AppConfig = Omit<HolderConfig, 'depth'> & { stickerCapacity: StickerCapacity; assembled: boolean };
type HexStickerLogo = { name: string; url: string };
type GitHubDirectoryItem = { name: string; type: string; download_url: string | null };
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
  const [fingerNotch, setFingerNotch] = useState(true);
  const [part, setPart] = useState<HolderPart>('both');
  const [logoSvg, setLogoSvg] = useState<string | null>(null);
  const [logoScale, setLogoScale] = useState(1);
  const [logoX, setLogoX] = useState(0);
  const [logoZ, setLogoZ] = useState(0);
  const [logoRotation, setLogoRotation] = useState(0);
  const [logoForegroundOnly, setLogoForegroundOnly] = useState(false);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogLogos, setCatalogLogos] = useState<HexStickerLogo[]>([]);
  const [catalogState, setCatalogState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [assembled, setAssembled] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState('');
  const configRef = useRef<AppConfig>({ stickerCapacity, cellWidth, embossed, texture, fingerNotch, part, logoSvg, logoScale, logoX, logoZ, logoRotation, logoForegroundOnly, assembled });

  const depth = depthForStickerCapacity(stickerCapacity);
  const config: HolderConfig = { depth, cellWidth, embossed, texture, fingerNotch, part, logoSvg, logoScale, logoX, logoZ, logoRotation, logoForegroundOnly };

  useEffect(() => {
    configRef.current = { stickerCapacity, cellWidth, embossed, texture, fingerNotch, part, logoSvg, logoScale, logoX, logoZ, logoRotation, logoForegroundOnly, assembled };
  }, [stickerCapacity, cellWidth, embossed, texture, fingerNotch, part, logoSvg, logoScale, logoX, logoZ, logoRotation, logoForegroundOnly, assembled]);

  async function loadCatalog(force = false) {
    if (!force && (catalogState === 'ready' || catalogState === 'loading')) return;
    setCatalogState('loading');
    try {
      const response = await fetch('https://api.github.com/repos/rstudio/hex-stickers/contents/SVG?ref=main', {
      headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error('The collection could not be loaded.');
      const items = await response.json() as unknown;
      if (!Array.isArray(items)) throw new Error('The collection response was not valid.');
      const logos = items
        .filter((item): item is GitHubDirectoryItem => Boolean(item) && typeof item === 'object'
          && typeof (item as GitHubDirectoryItem).name === 'string'
          && typeof (item as GitHubDirectoryItem).download_url === 'string'
          && (item as GitHubDirectoryItem).type === 'file'
          && (item as GitHubDirectoryItem).name.toLowerCase().endsWith('.svg'))
        .map((item) => ({ name: item.name, url: item.download_url! }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCatalogLogos(logos);
      setCatalogState('ready');
    } catch (error) {
      console.error(error);
      setCatalogState('error');
    }
  }

  function openCatalog() {
    setCatalogOpen(true);
    void loadCatalog();
  }

  useEffect(() => {
    const context = (document as ModelContextDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
    const isPart = (value: unknown): value is HolderPart => value === 'body' || value === 'lid' || value === 'both';

    void Promise.resolve(context.registerTool({
      name: 'configure_sticker_holder',
      title: 'Configure hex sticker holder',
      description: 'Set the sticker capacity, honeycomb finish, output parts, and visible arrangement. The inside width is fixed at 46 mm.',
      inputSchema: {
        type: 'object',
        properties: {
          stickerCapacity: { type: 'number', enum: [...STICKER_CAPACITIES], description: 'Number of stickers the holder should fit.' },
          cellWidth: { type: 'number', minimum: 1.8, maximum: 8, description: 'Honeycomb flat-to-flat width in millimetres.' },
          embossed: { type: 'boolean', description: 'Raise the honeycomb cells instead of engraving them.' },
          texture: { type: 'boolean', description: 'Show and export the honeycomb texture.' },
          fingerNotch: { type: 'boolean', description: 'Add a thumb-width recess under one lid edge.' },
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
        if (typeof next.texture !== 'boolean' || typeof next.embossed !== 'boolean' || typeof next.fingerNotch !== 'boolean' || typeof next.assembled !== 'boolean' || !isPart(next.part)) {
          throw new Error('The supplied finish or output selection is invalid.');
        }
        if (!next.texture) next.embossed = false;
        if (next.part !== 'both') next.assembled = false;
        setStickerCapacity(next.stickerCapacity);
        setCellWidth(next.cellWidth);
        setEmbossed(next.embossed);
        setTexture(next.texture);
        setFingerNotch(next.fingerNotch);
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

  function setLidArtwork(svg: string, name: string, foregroundOnly = false) {
    if (!/<svg[\s>]/i.test(svg)) {
      setStatus('That file is not a valid SVG.');
      return false;
    }
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (parsed.querySelector('parsererror')) {
      setStatus('That SVG could not be read.');
      return false;
    }
    if (!hasFilledSvgShape(svg)) {
      setStatus('Use an SVG with at least one filled shape.');
      return false;
    }
    setLogoSvg(svg);
    setLogoName(name);
    setLogoScale(1);
    setLogoX(0);
    setLogoZ(0);
    setLogoRotation(0);
    setLogoForegroundOnly(foregroundOnly);
    if (part === 'both') setAssembled(true);
    const detailNotice = foregroundOnly && isComplexSvgForPrint(svg)
      ? ' Its smallest details were simplified for a reliable 0.2 mm print modifier.'
      : '';
    setStatus(foregroundOnly
      ? `Catalog logo added with its badge background removed.${detailNotice} Use its frame in the assembled preview to position it.`
      : `Logo added.${detailNotice} Use its frame in the assembled preview to position it.`);
    return true;
  }

  function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.svg') || file.size > 500_000) {
      setStatus('Choose an SVG logo smaller than 500 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const svg = typeof reader.result === 'string' ? reader.result : '';
      setLidArtwork(svg, file.name);
    };
    reader.readAsText(file);
  }

  async function chooseCatalogLogo(logo: HexStickerLogo) {
    setStatus(`Loading ${logo.name}…`);
    try {
      const response = await fetch(logo.url);
      if (!response.ok) throw new Error('The selected SVG could not be loaded.');
      const svg = await response.text();
      if (setLidArtwork(svg, logo.name, true)) setCatalogOpen(false);
    } catch (error) {
      console.error(error);
      setStatus('The selected SVG could not be loaded.');
    }
  }

  function removeLogo() {
    setLogoSvg(null);
    setLogoName(null);
    setLogoScale(1);
    setLogoX(0);
    setLogoZ(0);
    setLogoRotation(0);
    setLogoForegroundOnly(false);
    setStatus('');
  }

  async function downloadStl() {
    if (isExporting) return;
    setIsExporting(true);
    setStatus('Preparing your STL…');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    let model: ReturnType<typeof buildHolderModel> | null = null;
    let printableModel: Awaited<ReturnType<typeof makePrintableExportModel>> | null = null;
    let logoModel: ReturnType<typeof buildHolderModel> | null = null;
    try {
      // Keep the holder and lid as one mesh each. The color modifier remains
      // a separate, aligned file for slicers that support multi-color prints.
      model = buildHolderModel({ ...config, logoSvg: null }, { arrangement: 'print', preview: false });
      printableModel = await makePrintableExportModel(model);
      if (!printableModel.children.length) throw new Error('The printable model is empty.');
      // Three.js is Y-up; STL/slicer convention is Z-up.
      printableModel.rotation.x = Math.PI / 2;
      printableModel.updateMatrixWorld(true);
      const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
      const exporter = new STLExporter();
      const data = exporter.parse(printableModel, { binary: true });
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

      let modifierTriangleCount = 0;
      if (config.logoSvg && part !== 'body') {
        // Match the selected print layout. In a body + lid export the lid is
        // deliberately offset from the body, so the modifier must keep that
        // same world transform for slicers to import it in the right place.
        logoModel = buildHolderModel({ ...config, part }, { arrangement: 'print', preview: false });
        const modifierModel = makeLogoModifierExportModel(logoModel);
        if (!modifierModel) throw new Error('The SVG does not contain a filled shape that can be exported.');
        modifierModel.rotation.x = Math.PI / 2;
        modifierModel.updateMatrixWorld(true);

        const modifierData = exporter.parse(modifierModel, { binary: true });
        modifierTriangleCount = modifierData.getUint32(80, true);
        if (modifierTriangleCount === 0 || modifierData.byteLength !== 84 + modifierTriangleCount * 50) {
          throw new Error('The logo modifier STL is incomplete.');
        }
        const modifierBlob = new Blob([modifierData.buffer], { type: 'model/stl' });
        const modifierUrl = URL.createObjectURL(modifierBlob);
        const modifierLink = document.createElement('a');
        modifierLink.href = modifierUrl;
        modifierLink.download = 'hex-sticker-holder-lid-logo-modifier.stl';
        document.body.appendChild(modifierLink);
        modifierLink.click();
        modifierLink.remove();
        window.setTimeout(() => URL.revokeObjectURL(modifierUrl), 1000);
      }

      const modifierSummary = modifierTriangleCount ? ` + ${modifierTriangleCount.toLocaleString()} logo modifier triangles` : '';
      setStatus(`Downloaded ${triangleCount.toLocaleString()} holder triangles${modifierSummary}`);
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : 'The STL could not be created.');
    } finally {
      if (printableModel) disposeHolderModel(printableModel);
      if (model) disposeHolderModel(model);
      if (logoModel) disposeHolderModel(logoModel);
      setIsExporting(false);
    }
  }

  const visibleCatalogLogos = catalogLogos.filter((logo) => logo.name.toLowerCase().includes(catalogQuery.trim().toLowerCase()));

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

            <fieldset className="space-y-4 border-t border-[#e2e9eb] pt-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[#648087]">Lid fit</legend>
              <ToggleRow
                id="finger-notch"
                label="Lid notch"
                description="Adds matching half-hex openings on opposite walls to expose the lid edge."
                checked={fingerNotch}
                onCheckedChange={(enabled) => { setFingerNotch(enabled); setStatus(''); }}
              />
            </fieldset>

            <fieldset className="space-y-4 border-t border-[#e2e9eb] pt-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-[#648087]">Lid artwork</legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#9bb4b9] px-3 text-sm font-medium text-[#315964] transition hover:border-[#0c697a] hover:bg-[#f2fbfa]">
                  <Upload className="size-4" /> {logoSvg ? 'Replace SVG' : 'Upload SVG'}
                  <input type="file" accept=".svg,image/svg+xml" className="sr-only" onChange={(event) => uploadLogo(event.currentTarget.files?.[0])} />
                </label>
                <button type="button" onClick={openCatalog} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[#9bb4b9] px-3 text-sm font-medium text-[#315964] transition hover:border-[#0c697a] hover:bg-[#f2fbfa]">
                  <Images className="size-4" /> Browse logos
                </button>
              </div>
              {logoSvg && (
                <>
                  <div className="flex items-center justify-between rounded-lg bg-[#f1f6f5] px-3 py-2 text-sm font-medium text-[#315964]">
                    <span className="truncate pr-2">{logoName ?? 'SVG logo'}</span>
                    <button type="button" onClick={removeLogo} className="grid size-7 place-items-center rounded-md text-[#52717a] transition hover:bg-white hover:text-[#102a33]" aria-label="Remove SVG logo"><X className="size-4" /></button>
                  </div>
                  <p className="text-xs leading-5 text-[#52717a]">Select the artwork in the assembled preview to reveal its frame. Drag inside to move, use corners to scale, the round handle to rotate, and Delete or Backspace to remove it.</p>
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
            <LiveModelViewer
              {...config}
              assembled={assembled}
              resetToken={resetToken}
              onLogoTransformChange={({ x, z, scale, rotation }) => {
                setLogoX(x);
                setLogoZ(z);
                setLogoScale(scale);
                setLogoRotation(rotation);
                setStatus('');
              }}
              onLogoRemove={() => {
                removeLogo();
                setStatus('Logo removed.');
              }}
            />
          </div>
        </section>
      </section>
      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className="h-[min(700px,calc(100vh-2rem))] min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] max-w-[calc(100%-2rem)] gap-3 overflow-hidden p-5 sm:max-w-3xl" aria-describedby="hex-logo-catalog-description">
          <DialogHeader className="pr-8">
            <DialogTitle>Browse hex logos</DialogTitle>
            <DialogDescription id="hex-logo-catalog-description">Select a logo from the rstudio/hex-stickers collection.</DialogDescription>
          </DialogHeader>
          <Input value={catalogQuery} onChange={(event) => setCatalogQuery(event.currentTarget.value)} placeholder="Search logos" aria-label="Search hex logo collection" className="border-[#b9ced3]" />
          <div className="min-h-0 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]">
            {catalogState === 'loading' || catalogState === 'idle' ? (
              <div className="grid min-h-48 place-items-center text-sm text-[#52717a]"><LoaderCircle className="size-5 animate-spin" /></div>
            ) : catalogState === 'error' ? (
              <div className="grid min-h-48 place-items-center gap-3 text-center text-sm text-[#52717a]">
                <span>The collection could not be loaded.</span>
                <button type="button" onClick={() => void loadCatalog(true)} className="rounded-md border border-[#9bb4b9] px-3 py-1.5 font-medium text-[#315964]">Try again</button>
              </div>
            ) : visibleCatalogLogos.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {visibleCatalogLogos.map((logo) => (
                  <button key={logo.name} type="button" onClick={() => void chooseCatalogLogo(logo)} className="group overflow-hidden rounded-lg border border-[#d7e1e3] bg-white text-left transition hover:border-[#0c697a] hover:bg-[#f2fbfa] focus-visible:ring-3 focus-visible:ring-[#0c697a]/30">
                    <span className="grid aspect-square place-items-center bg-[#f4f7f7] p-2">{/* oxlint-disable-next-line next/no-img-element -- remote public SVG thumbnails must keep their original view boxes. */}<img src={logo.url} alt="" loading="lazy" decoding="async" className="size-full object-contain" /></span>
                    <span className="block truncate px-2 py-1.5 text-xs font-medium text-[#315964]">{logo.name.replace(/\.svg$/i, '')}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid min-h-48 place-items-center text-sm text-[#52717a]">No matching logos.</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function DimensionControl({ label, detail, value, min, max, step, unit = 'mm', onChange, disabled = false }: { label: string; detail?: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void; disabled?: boolean }) {
  const id = label.toLowerCase().replaceAll(' ', '-');

  return (
    <div className={disabled ? 'opacity-45' : ''}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div><Label htmlFor={id} className="text-sm font-semibold">{label}</Label>{detail && <p className="mt-0.5 text-xs text-[#52717a]">{detail}</p>}</div>
        <div className="relative w-28">
          <Input id={id} type="number" inputMode="decimal" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) onChange(clamp(next, min, max)); }} onBlur={(event) => { event.currentTarget.value = String(value); }} className="h-9 border-[#b9ced3] bg-white pr-9 text-right font-mono text-sm" />
          <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-[#52717a]">{unit}</span>
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
