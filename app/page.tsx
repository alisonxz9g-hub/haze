'use client';

import { useEffect, useRef, useState } from 'react';
import { HazeIcon } from '@/components/haze-icon';
import type { HazeProgress, HazeReport, HazeResult } from '@/lib/haze-core';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toLocaleString('pt-BR', { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

type PreparedDownload = { blob: Blob; url: string; name: string };
type SavePickerWindow = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
  }) => Promise<FileSystemFileHandle>;
};

function supportsDirectFileSave() {
  return (
    typeof window !== 'undefined' &&
    navigator.maxTouchPoints > 0 &&
    window.matchMedia('(pointer: coarse)').matches &&
    window.isSecureContext &&
    typeof (window as SavePickerWindow).showSaveFilePicker === 'function'
  );
}

const transformations = [
  ['Fast start', 'Move moov para antes do mdat.'],
  ['Timeline', 'Remove as listas de edição edts.'],
  ['Track AAC', 'Clona o áudio e adiciona amostras artificiais.'],
  ['Assinatura Haze', 'Acrescenta o trailer experimental.'],
];

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const dragDepth = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>(
    'idle',
  );
  const [progress, setProgress] = useState<HazeProgress>({ percent: 0, message: '' });
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<HazeReport | null>(null);
  const [download, setDownload] = useState<PreparedDownload | null>(null);
  const busy = status === 'running' || saving;
  const activeStep = status === 'success' ? 2 : file ? 1 : 0;
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));

  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  useEffect(
    () => () => {
      workerRef.current?.terminate();
    },
    [],
  );

  function choose(next: File | null) {
    if (busy) return;
    setDownload(null);
    setReport(null);
    setError('');
    setSaveError('');
    setSaveNotice('');
    setStatus('idle');
    setProgress({ percent: 0, message: '' });
    setFile(null);
    if (!next) return;
    if (!/\.(mp4|m4v)$/i.test(next.name) || next.size > 1024 ** 3 || next.size < 8) {
      setError(
        !/\.(mp4|m4v)$/i.test(next.name)
          ? 'Selecione um arquivo .mp4 ou .m4v com áudio AAC.'
          : next.size > 1024 ** 3
            ? 'O limite é de 1 GiB por arquivo. Escolha um vídeo menor.'
            : 'Este arquivo é pequeno demais para ser um MP4 válido.',
      );
      setStatus('error');
      return;
    }
    setFile(next);
  }

  function processFile() {
    if (!file || busy) return;
    setStatus('running');
    setDownload(null);
    setError('');
    setSaveError('');
    setSaveNotice('');
    setReport(null);
    setProgress({ percent: 4, message: 'Iniciando o laboratório local…' });
    try {
      const worker = new Worker(new URL('../lib/haze-worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;
      const finish = () => {
        worker.terminate();
        workerRef.current = null;
      };
      worker.onmessage = (
        event: MessageEvent<
          | { type: 'progress'; progress: HazeProgress }
          | { type: 'success'; result: HazeResult }
          | { type: 'error'; message: string }
        >,
      ) => {
        if (workerRef.current !== worker) return;
        if (event.data.type === 'progress') {
          setProgress(event.data.progress);
          return;
        }
        if (event.data.type === 'success') {
          const result = event.data.result;
          setDownload({
            blob: result.output,
            url: URL.createObjectURL(result.output),
            name: result.outputName,
          });
          setReport(result.report);
          setStatus('success');
        } else {
          setError(event.data.message);
          setStatus('error');
        }
        finish();
      };
      worker.onerror = () => {
        setError('O navegador interrompeu o processamento. Tente novamente.');
        setStatus('error');
        finish();
      };
      worker.postMessage({ file });
    } catch {
      workerRef.current?.terminate();
      workerRef.current = null;
      setError(
        'Não foi possível iniciar o processamento local. Recarregue a página em um navegador atualizado.',
      );
      setStatus('error');
    }
  }

  async function downloadMp4() {
    if (!download || saving) return;
    let outputHandle: FileSystemFileHandle | null = null;
    if (supportsDirectFileSave()) {
      try {
        const saveWindow = window as SavePickerWindow;
        if (!saveWindow.showSaveFilePicker)
          throw new Error('Seletor de arquivos indisponível.');
        // Preserve a ativação do toque: nenhuma operação assíncrona antes do seletor.
        outputHandle = await saveWindow.showSaveFilePicker({
          suggestedName: download.name,
        });
      } catch (saveFailure) {
        if (saveFailure instanceof DOMException && saveFailure.name === 'AbortError')
          return;
        const detail = saveFailure instanceof Error ? ` (${saveFailure.message})` : '';
        setSaveError(`O Chrome não abriu o local para salvar${detail}`);
        return;
      }
    }
    setSaveError('');
    setSaveNotice('');
    setSaving(true);
    try {
      if (outputHandle) {
        const writable = await outputHandle.createWritable();
        try {
          await writable.write(download.blob);
          await writable.close();
        } catch (writeFailure) {
          await writable.abort().catch(() => undefined);
          throw writeFailure;
        }
        setSaveNotice('MP4 salvo no aparelho.');
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
    } catch (saveFailure) {
      const detail = saveFailure instanceof Error ? ` (${saveFailure.message})` : '';
      setSaveError(`Não foi possível gravar o MP4 no aparelho${detail}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="haze-app">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="site-header">
        <div className="page-shell header-inner">
          <a className="brand" href="#" aria-label="Haze, início">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="brand-word">
              haze<span className="brand-period">.</span>
            </span>
            <span className="brand-version">4.0</span>
          </a>
          <nav className="header-nav" aria-label="Navegação principal">
            <a className="nav-current" href="#laboratorio">
              Laboratório
            </a>
            <a href="#compatibilidade">Compatibilidade</a>
          </nav>
          <a
            className="source-link"
            href="https://github.com/alisonxz9g-hub/haze"
            target="_blank"
            rel="noreferrer"
          >
            Código-fonte <HazeIcon name="external" />
          </a>
        </div>
      </header>

      <main id="conteudo" className="page-shell">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot" /> MP4 CONTAINER LAB{' '}
              <span className="eyebrow-divider">/</span> OBSERVED 4.0
            </p>
            <h1 id="hero-title">
              Um novo contêiner.
              <br />
              <span>O mesmo vídeo.</span>
            </h1>
            <p className="hero-description">
              Reestruture seu MP4 direto no navegador, sem recodificar os streams
              compatíveis. Seu vídeo não precisa sair do seu dispositivo.
            </p>
            <div className="hero-benefits">
              <span>
                <HazeIcon name="lock" /> Sem upload
              </span>
              <span>
                <HazeIcon name="shield" /> Original intacto
              </span>
              <span className="experimental-label">
                <HazeIcon name="warning" /> Experimental
              </span>
            </div>
          </div>
          <div
            className="container-map"
            aria-label="Esquema simplificado: o moov é movido para antes do mdat e um trailer é acrescentado."
          >
            <div className="map-heading">
              <span className="eyebrow">POR DENTRO DO MP4</span>
              <span className="map-file">.mp4</span>
            </div>
            <div className="map-row-label">
              Estrutura de entrada <span>ANTES</span>
            </div>
            <div className="box-track" aria-hidden="true">
              <span className="box-small">ftyp</span>
              <span className="box-media">mdat</span>
              <span className="box-moov">moov</span>
            </div>
            <div className="map-connector">
              <span />
              <HazeIcon name="download" />
              <span />
            </div>
            <div className="map-row-label">
              Variante Haze <span>DEPOIS</span>
            </div>
            <div className="box-track box-track-output" aria-hidden="true">
              <span className="box-small">ftyp</span>
              <span className="box-moov">moov</span>
              <span className="box-media">mdat</span>
              <span className="box-trailer">+</span>
            </div>
            <p className="map-caption">
              Esquema simplificado · mídia preservada, estrutura alterada.
            </p>
          </div>
        </section>

        <section
          id="laboratorio"
          className="workspace"
          aria-label="Laboratório de processamento"
        >
          <div className="upload-panel panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">SEU ESPAÇO DE TRABALHO</p>
                <h2>Comece pelo seu vídeo.</h2>
              </div>
              <span
                className={`state-tag ${status === 'success' ? 'state-tag-success' : ''}`}
              >
                <span className="status-dot" />
                {status === 'running'
                  ? 'Processando'
                  : status === 'success'
                    ? 'Concluído'
                    : status === 'error'
                      ? 'Verifique o arquivo'
                      : file
                        ? 'Selecionado'
                        : 'Aguardando arquivo'}
              </span>
            </div>
            <ol className="workflow-steps" aria-label="Etapas do processamento">
              {['Selecionar', 'Processar', 'Baixar'].map((label, index) => (
                <li
                  key={label}
                  className={index <= activeStep ? 'step-active' : ''}
                  aria-current={index === activeStep ? 'step' : undefined}
                >
                  <span className="step-number">
                    {index < activeStep ? <HazeIcon name="check" /> : `0${index + 1}`}
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className={`dropzone ${dragging ? 'dropzone-dragging' : ''} ${file ? 'dropzone-selected' : ''}`}
              disabled={busy}
              aria-label={
                file ? `Trocar arquivo: ${file.name}` : 'Selecionar vídeo MP4 ou M4V'
              }
              aria-describedby="file-requirements"
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!busy) {
                  dragDepth.current += 1;
                  setDragging(true);
                }
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (!dragDepth.current) setDragging(false);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
              }}
              onDrop={(event) => {
                event.preventDefault();
                dragDepth.current = 0;
                setDragging(false);
                if (event.dataTransfer.files[0]) choose(event.dataTransfer.files[0]);
              }}
            >
              <span className="upload-symbol">
                <HazeIcon name={file ? 'file' : 'upload'} />
              </span>
              <span className={`dropzone-title ${file ? 'selected-file-name' : ''}`}>
                {file
                  ? file.name
                  : dragging
                    ? 'Solte o vídeo aqui'
                    : 'Arraste seu vídeo para cá'}
              </span>
              <span className="dropzone-description">
                {file
                  ? `${formatBytes(file.size)} · ${busy ? 'processamento local' : status === 'success' ? 'original preservado' : 'pronto para análise'}`
                  : 'ou escolha um arquivo no seu dispositivo'}
              </span>
              <span className="file-select-label">
                {busy
                  ? 'Processamento local em andamento'
                  : file
                    ? 'Trocar arquivo'
                    : 'Escolher arquivo'}
                {!busy && <HazeIcon name="arrow" />}
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,.mp4,.m4v"
              className="sr-only"
              tabIndex={-1}
              aria-label="Arquivo de vídeo"
              disabled={busy}
              onChange={(event) => {
                if (event.target.files?.[0]) choose(event.target.files[0]);
                event.target.value = '';
              }}
            />
            <div id="file-requirements" className="file-requirements">
              <span>MP4 ou M4V</span>
              <span>Áudio AAC</span>
              <span>Até 1 GiB</span>
            </div>
            <div className="upload-actions">
              <p className="privacy-note">
                <HazeIcon name="lock" />
                <span>
                  Só no seu dispositivo.
                  <br />
                  <strong>Nenhum vídeo é enviado.</strong>
                </span>
              </p>
              <div className="action-buttons">
                {file && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => choose(null)}
                    disabled={busy}
                    aria-label="Remover arquivo selecionado"
                    title="Remover arquivo"
                  >
                    <HazeIcon name="close" />
                  </button>
                )}
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!file || busy}
                  onClick={processFile}
                >
                  <HazeIcon
                    name={status === 'running' ? 'spinner' : 'scan'}
                    className={status === 'running' ? 'spin' : undefined}
                  />
                  {status === 'running' ? 'Processando…' : 'Analisar e processar'}
                </button>
              </div>
            </div>
            <div className="live-message sr-only" role="status" aria-live="polite">
              {status === 'running'
                ? progress.message
                : status === 'success'
                  ? 'Processamento concluído. Seu MP4 e o relatório estão disponíveis.'
                  : file && status === 'idle'
                    ? `Arquivo ${file.name} selecionado.`
                    : ''}
            </div>
            {status === 'running' && (
              <div className="processing-state">
                <div className="progress-caption">
                  <label htmlFor="haze-progress">{progress.message}</label>
                  <span>{percent}%</span>
                </div>
                <progress id="haze-progress" max={100} value={percent}>
                  {percent}%
                </progress>
                <p>Você pode manter esta aba aberta enquanto o Haze trabalha.</p>
              </div>
            )}
            {status === 'error' && (
              <div className="feedback feedback-error" role="alert">
                <HazeIcon name="warning" />
                <div>
                  <h3>Não foi possível processar</h3>
                  <p>{error}</p>
                  <a href="#compatibilidade">
                    Conferir os requisitos <HazeIcon name="arrow" />
                  </a>
                </div>
              </div>
            )}
            {status === 'success' && download && (
              <div className="feedback feedback-success">
                <HazeIcon name="check" />
                <div className="success-copy">
                  <h3>Seu MP4 está pronto.</h3>
                  <p>Variante criada localmente, sem recodificação.</p>
                  <p className="output-filename">
                    {download.name} · {formatBytes(download.blob.size)}
                  </p>
                </div>
                <button
                  type="button"
                  className="button button-success"
                  disabled={saving}
                  onClick={downloadMp4}
                >
                  <HazeIcon
                    name={saving ? 'spinner' : 'download'}
                    className={saving ? 'spin' : undefined}
                  />
                  {saving ? 'Salvando…' : 'Baixar MP4'}
                </button>
              </div>
            )}
            {saveError && (
              <div className="feedback feedback-error" role="alert">
                <HazeIcon name="warning" />
                <p>{saveError}</p>
              </div>
            )}
            {saveNotice && (
              <output className="save-notice" aria-live="polite">
                <HazeIcon name="check" />
                {saveNotice}
              </output>
            )}
          </div>

          <aside className="workspace-aside">
            <section className="process-panel panel" aria-labelledby="process-title">
              <p className="eyebrow">SEM CAIXA-PRETA</p>
              <h2 id="process-title">O que será alterado</h2>
              <ol className="transformation-list">
                {transformations.map(([title, detail], index) => (
                  <li key={title}>
                    <span className="transformation-number">0{index + 1}</span>
                    <div>
                      <h3>{title}</h3>
                      <p>{detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="preserved-note">
                <HazeIcon name="shield" />
                <p>
                  Os streams compatíveis são reutilizados{' '}
                  <strong>sem recodificação.</strong>
                </p>
              </div>
            </section>
            <section className="experimental-note" aria-labelledby="experimental-title">
              <HazeIcon name="warning" />
              <div>
                <h3 id="experimental-title">Um experimento, não uma promessa.</h3>
                <p>
                  A saída não é compatível com ISO BMFF: contém dados fora do mdat. Não
                  há garantia de mais qualidade ou de tratamento diferente por
                  plataformas.
                </p>
              </div>
            </section>
          </aside>
        </section>

        {report && (
          <section className="report-panel panel" aria-labelledby="report-title">
            <div className="report-heading">
              <div>
                <p className="eyebrow">RESULTADO DO PROCESSAMENTO</p>
                <h2 id="report-title">Cada alteração, às claras.</h2>
              </div>
              <span className="report-badge">
                <HazeIcon name="warning" /> Não conforme a ISO BMFF
              </span>
            </div>
            <dl className="report-grid">
              {[
                ['Entrada', formatBytes(report.inputSize)],
                ['Saída', formatBytes(report.outputSize)],
                ['Áudio', `${report.audioSampleEntry} · preservado`],
                ['Tracks', `${report.originalTrackCount} → ${report.outputTrackCount}`],
                ['Amostras AAC', report.originalAudioSamples.toLocaleString('pt-BR')],
                ['Amostras artificiais', report.dummySamples.toLocaleString('pt-BR')],
                ['Trailer', formatBytes(report.trailerSize)],
                ['Classificação', report.classification],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="report-details">
              <div>
                <h3>Layout do contêiner</h3>
                <p className="layout-value">
                  <span>{report.inputLayout.join(' · ')}</span>
                  <HazeIcon name="arrow" />
                  <span>{report.outputLayout.join(' · ')}</span>
                </p>
              </div>
              <div>
                <h3>SHA-256 do mdat</h3>
                <p className="hash-value">
                  {report.mdatSha256 ?? 'Não calculado para mdat acima de 256 MiB.'}
                </p>
              </div>
            </div>
          </section>
        )}

        <section
          id="compatibilidade"
          className="compatibility-section"
          aria-labelledby="compatibility-title"
        >
          <div className="compatibility-intro">
            <p className="eyebrow">ANTES DE COMEÇAR</p>
            <h2 id="compatibility-title">
              Bom saber.
              <br />
              <span>Melhor entender.</span>
            </h2>
            <p>
              O Haze valida a estrutura antes de gerar qualquer saída. O arquivo
              original nunca é alterado.
            </p>
            <a
              className="text-link"
              href="https://github.com/alisonxz9g-hub/haze#compatibilidade"
              target="_blank"
              rel="noreferrer"
            >
              Documentação técnica <HazeIcon name="external" />
            </a>
          </div>
          <div className="faq-list">
            <details>
              <summary>
                Quais arquivos são compatíveis?
                <HazeIcon name="chevron" />
              </summary>
              <div className="faq-answer">
                <p>
                  MP4 ou M4V de até 1 GiB, não fragmentado, com exatamente uma track de
                  vídeo e uma de áudio AAC (mp4a).
                </p>
                <p>
                  São necessários ftyp, moov e mdat únicos, metadata ilst e tabelas
                  stco, stsc, stsz variável e stts consistentes. Arquivos com co64 são
                  recusados. Áudio Opus precisa ser convertido para AAC antes.
                </p>
              </div>
            </details>
            <details>
              <summary>
                O resultado melhora a qualidade do vídeo?
                <HazeIcon name="chevron" />
              </summary>
              <div className="faq-answer">
                <p>
                  Não há essa garantia. O Haze replica uma transformação experimental de
                  contêiner: ele não melhora a imagem nem promete menos compressão em
                  plataformas.
                </p>
                <p>
                  A saída contém um trailer fora dos boxes e não é conforme ao padrão
                  ISO BMFF. Guarde sempre o original e teste a compatibilidade do
                  resultado.
                </p>
              </div>
            </details>
            <details>
              <summary>
                Como funciona o download no celular?
                <HazeIcon name="chevron" />
              </summary>
              <div className="faq-answer">
                <p>
                  No Chrome 132 ou mais recente para Android, com o seletor disponível e
                  o site em HTTPS, o botão Baixar MP4 permite escolher onde salvar o
                  arquivo diretamente.
                </p>
                <p>
                  Em outros navegadores, o Haze tenta o download convencional. A
                  disponibilidade depende do navegador e do sistema. Nenhum vídeo é
                  enviado a um servidor.
                </p>
              </div>
            </details>
          </div>
        </section>
      </main>
      <footer className="site-footer page-shell">
        <p>
          <span className="footer-brand">haze.</span> Observed Engine 4.0
        </p>
        <p>Local por natureza. Experimental por definição.</p>
        <a href="#laboratorio">
          Voltar ao laboratório <HazeIcon name="arrow" />
        </a>
      </footer>
    </div>
  );
}
