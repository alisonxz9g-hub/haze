'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CircleX,
  Download,
  FileVideo,
  FlaskConical,
  LoaderCircle,
  LockKeyhole,
  ScanSearch,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import type { HazeProgress, HazeReport, HazeResult } from '@/lib/haze-core';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

type PreparedDownload = {
  blob: Blob;
  url: string;
  name: string;
};

function shouldStreamToBrowserDownload() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    navigator.maxTouchPoints > 0 &&
    window.matchMedia('(pointer: coarse)').matches &&
    'serviceWorker' in navigator
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<
    'idle' | 'running' | 'success' | 'error'
  >('idle');
  const [progress, setProgress] = useState<HazeProgress>({
    percent: 0,
    message: '',
  });
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<HazeReport | null>(null);
  const [download, setDownload] = useState<PreparedDownload | null>(null);

  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url);
    },
    [download],
  );

  function choose(next: File | undefined) {
    if (!next) return;
    if (download) URL.revokeObjectURL(download.url);
    setDownload(null);
    setReport(null);
    setError('');
    setSaveError('');
    setSaveNotice('');
    setSaving(false);
    setStatus('idle');
    setProgress({ percent: 0, message: '' });
    setFile(next);
  }

  function processFile() {
    if (!file || status === 'running') return;
    setStatus('running');
    setError('');
    setSaveError('');
    setSaveNotice('');
    setSaving(false);
    setReport(null);
    setProgress({ percent: 4, message: 'Iniciando o laboratório local…' });

    const worker = new Worker(
      new URL('../lib/haze-worker.ts', import.meta.url),
      {
        type: 'module',
      },
    );
    worker.onmessage = (
      event: MessageEvent<
        | { type: 'progress'; progress: HazeProgress }
        | { type: 'success'; result: HazeResult }
        | { type: 'error'; message: string }
      >,
    ) => {
      if (event.data.type === 'progress') {
        setProgress(event.data.progress);
        return;
      }
      if (event.data.type === 'success') {
        const result = event.data.result;
        if (download) URL.revokeObjectURL(download.url);
        setDownload({
          blob: result.output,
          url: URL.createObjectURL(result.output),
          name: result.outputName,
        });
        setReport(result.report);
        setStatus('success');
        worker.terminate();
        return;
      }
      setError(event.data.message);
      setStatus('error');
      worker.terminate();
    };
    worker.onerror = () => {
      setError('O navegador interrompeu o processamento. Tente novamente.');
      setStatus('error');
      worker.terminate();
    };
    worker.postMessage({ file });
  }

  async function downloadMp4() {
    if (!download || saving) return;

    setSaveError('');
    setSaveNotice('');
    setSaving(true);
    try {
      if (shouldStreamToBrowserDownload()) {
        const { default: streamSaver } = await import('streamsaver');
        const siteRoot = new URL('./', window.location.href);
        streamSaver.mitm = new URL(
          'streamsaver/mitm.html?version=2.0.0',
          siteRoot,
        ).href;
        const browserDownload = streamSaver.createWriteStream(download.name, {
          size: download.blob.size,
        });
        await download.blob.stream().pipeTo(browserDownload);
        setSaveNotice(
          'Download concluído pelo Chrome. O MP4 está na pasta de downloads.',
        );
        return;
      }

      const anchor = document.createElement('a');
      anchor.href = download.url;
      anchor.download = download.name;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setSaveNotice('Download iniciado pelo navegador.');
    } catch {
      setSaveError(
        'O Chrome não conseguiu iniciar o download local. Mantenha esta página aberta e tente novamente.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/8 bg-[#080d18]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-300">
              <FlaskConical className="size-5" />
            </div>
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300/80">
                Container laboratory
              </p>
              <h1 className="text-base font-semibold tracking-tight text-white sm:text-lg">
                Observed Haze 4.0
              </h1>
            </div>
          </div>
          <Badge className="gap-1.5 border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-emerald-200">
            <LockKeyhole className="size-3.5" />
            100% no navegador
          </Badge>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-8 max-w-3xl">
          <Badge
            variant="outline"
            className="mb-4 border-amber-400/30 bg-amber-400/8 text-amber-200"
          >
            OBSERVED · EXPERIMENTAL · NOT ISO BMFF COMPLIANT
          </Badge>
          <h2 className="text-3xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-5xl">
            Reestruture seu MP4.
            <br />
            <span className="text-slate-400">Sem enviar o vídeo.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
            Réplica da mutação de contêiner observada no Haze Engine 4.0. O
            processamento acontece localmente e preserva os streams compatíveis
            sem recodificação.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,.75fr)]">
          <section className="rounded-2xl border border-white/10 bg-card p-4 shadow-2xl shadow-black/20 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Arquivo de entrada
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">
                  Selecione um MP4 com áudio AAC
                </h3>
              </div>
              <span className="rounded-lg border border-white/8 bg-white/4 px-2.5 py-1 font-mono text-[10px] text-slate-400">
                MP4 · M4V
              </span>
            </div>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={() => setDragging(true)}
              onDragLeave={() => setDragging(false)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                choose(event.dataTransfer.files[0]);
              }}
              className={`group flex min-h-60 w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center transition ${
                dragging
                  ? 'border-emerald-300 bg-emerald-400/10'
                  : 'border-slate-700 bg-[#0a111f] hover:border-slate-500 hover:bg-[#0c1525]'
              }`}
            >
              {file ? (
                <>
                  <div className="grid size-14 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300">
                    <FileVideo className="size-7" />
                  </div>
                  <p className="mt-4 max-w-full truncate font-medium text-white">
                    {file.name}
                  </p>
                  <p className="mt-1 font-mono text-xs text-slate-500">
                    {formatBytes(file.size)}
                  </p>
                  <span className="mt-4 text-xs text-emerald-300">
                    Clique para trocar o arquivo
                  </span>
                </>
              ) : (
                <>
                  <div className="grid size-14 place-items-center rounded-2xl border border-slate-700 bg-slate-800/60 text-slate-300 transition group-hover:border-emerald-400/30 group-hover:text-emerald-300">
                    <UploadCloud className="size-7" />
                  </div>
                  <p className="mt-4 font-medium text-white">
                    Arraste o vídeo aqui
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    ou toque para selecionar no dispositivo
                  </p>
                </>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,.mp4,.m4v"
              className="sr-only"
              onChange={(event) => choose(event.target.files?.[0])}
            />

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <LockKeyhole className="size-3.5 text-emerald-400" />
                O arquivo nunca sai deste dispositivo.
              </div>
              <Button
                size="lg"
                disabled={!file || status === 'running'}
                onClick={processFile}
                className="h-11 gap-2 bg-emerald-400 px-5 font-semibold text-emerald-950 hover:bg-emerald-300"
              >
                {status === 'running' ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ScanSearch />
                )}
                {status === 'running' ? 'Processando…' : 'Analisar e processar'}
              </Button>
            </div>

            {status === 'running' && (
              <div className="mt-5 rounded-xl border border-sky-400/15 bg-sky-400/5 p-4">
                <Progress value={progress.percent} className="gap-2">
                  <ProgressLabel className="text-xs text-sky-100">
                    {progress.message}
                  </ProgressLabel>
                  <span className="ml-auto text-xs tabular-nums text-sky-300">
                    {`${progress.percent}%`}
                  </span>
                </Progress>
              </div>
            )}

            {status === 'error' && (
              <div
                role="alert"
                className="mt-5 flex gap-3 rounded-xl border border-rose-400/20 bg-rose-400/6 p-4"
              >
                <CircleX className="mt-0.5 size-4 shrink-0 text-rose-300" />
                <div>
                  <p className="text-sm font-medium text-rose-100">
                    Arquivo incompatível
                  </p>
                  <p className="mt-1 text-xs leading-5 text-rose-100/65">
                    {error}
                  </p>
                </div>
              </div>
            )}

            {status === 'success' && download && (
              <div className="mt-5 flex flex-col gap-4 rounded-xl border border-emerald-400/20 bg-emerald-400/6 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-300" />
                  <div>
                    <p className="text-sm font-medium text-emerald-100">
                      Variante Haze criada localmente
                    </p>
                    <p className="mt-1 text-xs text-emerald-100/55">
                      Payload de mídia reutilizado sem recodificação.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={downloadMp4}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-wait disabled:opacity-70"
                >
                  {saving ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {saving ? 'Baixando…' : 'Baixar MP4'}
                </button>
              </div>
            )}

            {saveError && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/6 px-4 py-3 text-xs leading-5 text-amber-100/75"
              >
                <p>{saveError}</p>
              </div>
            )}

            {saveNotice && (
              <output
                className="mt-3 block rounded-lg border border-emerald-400/20 bg-emerald-400/6 px-4 py-3 text-xs leading-5 text-emerald-100/75"
              >
                {saveNotice}
              </output>
            )}
          </section>

          <aside className="space-y-5">
            <section className="rounded-2xl border border-white/10 bg-card p-5">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                O que será alterado
              </p>
              <div className="mt-5 space-y-4">
                {[
                  ['01', 'Fast start', 'Move moov antes do mdat'],
                  ['02', 'Timeline', 'Remove edts das tracks'],
                  ['03', 'Track AAC', 'Clona e estende com amostras'],
                  ['04', 'Trailer', 'Grava a assinatura observada'],
                ].map(([step, title, detail]) => (
                  <div key={step} className="grid grid-cols-[28px_1fr] gap-3">
                    <span className="font-mono text-xs text-emerald-400">
                      {step}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-slate-200">
                        {title}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-500">
                        {detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-amber-400/15 bg-amber-400/5 p-5">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
                <div>
                  <p className="text-sm font-medium text-amber-100">
                    Resultado experimental
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-100/55">
                    A estrutura observada contém dados fora do mdat. Não existe
                    garantia de qualidade ou tratamento diferente por
                    plataformas.
                  </p>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/8 bg-white/3 p-4">
                <Check className="size-4 text-emerald-400" />
                <p className="mt-3 text-xs font-medium text-slate-200">
                  Vídeo preservado
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/3 p-4">
                <Download className="size-4 text-sky-400" />
                <p className="mt-3 text-xs font-medium text-slate-200">
                  Download local
                </p>
              </div>
            </div>
          </aside>
        </div>

        {report && (
          <section className="mt-5 rounded-2xl border border-white/10 bg-card p-5 sm:p-6">
            <div className="flex flex-col gap-3 border-b border-white/8 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400">
                  Relatório da transformação
                </p>
                <h3 className="mt-1 text-xl font-semibold text-white">
                  Payload preservado, contêiner alterado
                </h3>
              </div>
              <Badge
                variant="outline"
                className="border-amber-400/25 bg-amber-400/8 text-amber-200"
              >
                NOT ISO BMFF COMPLIANT
              </Badge>
            </div>

            <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Entrada', formatBytes(report.inputSize)],
                ['Saída', formatBytes(report.outputSize)],
                ['Áudio', `${report.audioSampleEntry} · preservado`],
                [
                  'Tracks',
                  `${report.originalTrackCount} → ${report.outputTrackCount}`,
                ],
                [
                  'Amostras AAC',
                  report.originalAudioSamples.toLocaleString('pt-BR'),
                ],
                [
                  'Amostras artificiais',
                  report.dummySamples.toLocaleString('pt-BR'),
                ],
                ['Trailer', formatBytes(report.trailerSize)],
                ['Classificação', report.classification],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-white/7 bg-[#0a111f] p-4"
                >
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {label}
                  </dt>
                  <dd className="mt-2 text-sm font-medium text-slate-200">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-white/7 bg-[#0a111f] p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  Layout
                </p>
                <p className="mt-2 font-mono text-xs leading-5 text-slate-300">
                  {report.inputLayout.join(' · ')}
                  <span className="mx-2 text-slate-600">→</span>
                  {report.outputLayout.join(' · ')}
                </p>
              </div>
              <div className="rounded-xl border border-white/7 bg-[#0a111f] p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  SHA-256 do mdat
                </p>
                <p className="mt-2 break-all font-mono text-[11px] leading-5 text-slate-300">
                  {report.mdatSha256 ??
                    'Não calculado para mdat acima de 256 MiB'}
                </p>
              </div>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
