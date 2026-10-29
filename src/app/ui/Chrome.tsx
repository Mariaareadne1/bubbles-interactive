import { useEffect, useRef, useState } from 'react';
import type { BubblesApp } from '../BubblesApp';
import { useAppState } from '../../state/store';
import { canRedo, canUndo } from '../../state/history';
import { showcaseDoc } from '../../state/document';
import { exportDocFile, importDocFile } from '../../state/persistence';
import { Icon } from './icons';

interface ChromeProps {
  app: BubblesApp;
  onCapture: () => void;
  onRecord: () => void;
}

const SHORTCUTS: [string, string][] = [
  ['Draw · Pop', 'D · P'],
  ['Bubble up', 'B'],
  ['Remove', 'Delete'],
  ['Undo · Redo', '⌘Z · ⇧⌘Z'],
  ['Next friend', 'Tab'],
  ['Deselect / cancel', 'Esc'],
  ['Hide interface', 'H'],
];

export function Chrome({ app, onCapture, onRecord }: ChromeProps) {
  const { store } = app;
  const tool = useAppState(store, (s) => s.tool);
  const history = useAppState(store, (s) => s.history);
  const hasDrawn = useAppState(store, (s) => s.hasDrawn);
  const count = useAppState(store, (s) => s.history.present.bubbles.length + s.history.present.garden.length);
  const bubbles = useAppState(store, (s) => s.history.present.bubbles.length);
  const toast = useAppState(store, (s) => s.toast);
  const loading = useAppState(store, (s) => s.loading);
  const recording = useAppState(store, (s) => s.recording);
  const selectedId = useAppState(store, (s) => s.selectedId);
  const [panel, setPanel] = useState<'none' | 'help' | 'menu'>('none');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (panel === 'none') return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.panel, .top-actions')) setPanel('none');
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [panel]);

  const quiet = selectedId !== null || (hasDrawn && tool === 'draw');
  const hint = quiet ? null : tool === 'draw' ? (count === 0 ? 'Draw a circle.' : 'Draw a circle — or tap a bubble to pop it.') : bubbles === 0 ? 'No bubbles to pop — switch to Draw and blow one.' : 'Tap a bubble — or swipe across a few.';

  const runMenu = (action: string) => {
    setPanel('none');
    if (action === 'reset') app.reset();
    if (action === 'showcase') app.loadDoc(showcaseDoc());
    if (action === 'export') exportDocFile(store.doc);
    if (action === 'import') fileRef.current?.click();
    if (action === 'hide') store.set({ uiHidden: true });
    if (action === 'record') onRecord();
  };

  return (
    <>
      <header className="wordmark">
        <h1>BUBBLES</h1>
        <p>draw one, pop it</p>
      </header>

      <div className="top-actions">
        <button className="icon-btn ghost" aria-label="Help" aria-expanded={panel === 'help'} title="Help" onClick={() => setPanel(panel === 'help' ? 'none' : 'help')}>
          <Icon name="help" />
        </button>
        <button className="icon-btn ghost" aria-label="Menu" aria-expanded={panel === 'menu'} title="More" onClick={() => setPanel(panel === 'menu' ? 'none' : 'menu')}>
          <Icon name="menu" />
        </button>
      </div>

      {panel === 'help' && (
        <section className="panel help" aria-label="How to play">
          <p className="lede">Draw a circle over the garden and it becomes a soap bubble with someone tiny asleep inside — a bunny, a chick, a kitten, a flower, a strawberry or a star. It floats away on the breeze. Tap it to pop it: whoever was inside wakes up and drifts down on a petal to stay in the garden. With Pop, swipe across bubbles to pop each one you touch. Click a friend in the garden to name it, bubble it back up, or say goodbye; drag to move it.</p>
          <dl>
            {SHORTCUTS.map(([what, key]) => (
              <div key={what}><dt>{what}</dt><dd>{key}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {panel === 'menu' && (
        <section className="panel menu" aria-label="Menu">
          <button onClick={() => runMenu('showcase')}>Showcase</button>
          <button onClick={() => runMenu('record')} disabled={recording}>Record 12-second clip</button>
          <button onClick={() => runMenu('hide')}>Hide interface <kbd>H</kbd></button>
          <hr />
          <button onClick={() => runMenu('export')}>Export scene…</button>
          <button onClick={() => runMenu('import')}>Import scene…</button>
          <hr />
          <button className="danger" onClick={() => runMenu('reset')} disabled={count === 0}>Clear the garden</button>
        </section>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            app.loadDoc(await importDocFile(file));
            store.toast('Scene imported.');
          } catch (err) {
            store.toast(err instanceof Error ? err.message : 'Could not import that file.');
          }
        }}
      />

      {hint && <p className="hint" aria-live="polite">{hint}</p>}
      {loading && <p className="loading" aria-live="polite">Waking the garden…</p>}

      <div className="dock">
        <nav className="toolbar" aria-label="Tools">
          <button className={tool === 'draw' ? 'tool on' : 'tool'} aria-pressed={tool === 'draw'} title="Draw a bubble (D)" onClick={() => store.set({ tool: 'draw' })}>
            <Icon name="draw" /><span>Draw</span>
          </button>
          <button className={tool === 'pop' ? 'tool on' : 'tool'} aria-pressed={tool === 'pop'} title="Pop bubbles — tap or swipe (P)" onClick={() => store.set({ tool: 'pop' })}>
            <Icon name="pop" /><span>Pop</span>
          </button>
          <span className="sep" />
          <button className="icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo(history)} onClick={() => app.undo()}>
            <Icon name="undo" />
          </button>
          <button className="icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo(history)} onClick={() => app.redo()}>
            <Icon name="redo" />
          </button>
          <span className="sep" />
          <button className="icon-btn" aria-label="Save image" title="Save image" onClick={onCapture}>
            <Icon name="camera" />
          </button>
        </nav>
      </div>

      {recording && <p className="rec" aria-live="polite"><i />Recording</p>}
      {toast && <Toast key={toast.id} text={toast.text} />}
    </>
  );
}

function Toast({ text }: { text: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGone(true), 3200);
    return () => window.clearTimeout(t);
  }, []);
  if (gone) return null;
  return <p className="toast" role="status">{text}</p>;
}
