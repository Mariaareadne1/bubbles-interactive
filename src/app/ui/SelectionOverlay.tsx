import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { BubblesApp } from '../BubblesApp';
import { useAppState } from '../../state/store';
import { NAME_MAX, cleanName, findGarden, suggestName, type GardenRecord } from '../../state/document';
import { Icon } from './icons';

/**
 * MEADOW's thin blue box around the selected passenger with a small bar of
 * its three actions: a name (with a 🎲 suggestion), Bubble up and Remove.
 * Positions are written straight to the DOM every frame.
 */

export function screenBox(app: BubblesApp, box3: THREE.Box3): { minX: number; minY: number; maxX: number; maxY: number } {
  const corner = new THREE.Vector3();
  const cam = app.engine.camera;
  const rect = app.rect;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box3.max.x : box3.min.x, i & 2 ? box3.max.y : box3.min.y, i & 4 ? box3.max.z : box3.min.z).project(cam);
    const sx = ((corner.x + 1) / 2) * rect.width;
    const sy = ((1 - corner.y) / 2) * rect.height;
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  return { minX, minY, maxX, maxY };
}

const LABELS: Record<GardenRecord['kind'], string> = {
  bunny: 'bunny', chick: 'chick', kitten: 'kitten', flower: 'flower', strawberry: 'strawberry', star: 'star',
};

function NameField({ app, friend }: { app: BubblesApp; friend: GardenRecord }) {
  const [draft, setDraft] = useState(friend.name ?? '');
  const [seen, setSeen] = useState(friend.name ?? '');
  // keep the field in step with undo/redo without fighting the person typing
  if ((friend.name ?? '') !== seen) {
    setSeen(friend.name ?? '');
    if (cleanName(draft) !== (friend.name ?? '')) setDraft(friend.name ?? '');
  }
  const rename = (value: string) => {
    setDraft(value);
    app.rename(friend.id, value);
  };
  const dice = () => rename(suggestName(app.store.doc.garden.map((d) => d.name ?? '').filter(Boolean)));
  return (
    <div className="friend-name">
      <input
        type="text"
        value={draft}
        maxLength={NAME_MAX + 4}
        placeholder={`Name this ${LABELS[friend.kind]}`}
        aria-label={`The ${LABELS[friend.kind]}'s name`}
        spellCheck={false}
        onChange={(e) => rename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
      <button className="icon-btn" aria-label="Suggest a name" title="Suggest a name" onClick={dice}>
        <span aria-hidden="true">🎲</span>
      </button>
    </div>
  );
}

export function SelectionOverlay({ app }: { app: BubblesApp }) {
  const selectedId = useAppState(app.store, (s) => s.selectedId);
  const friend = useAppState(app.store, (s) => findGarden(s.history.present, s.selectedId));
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    const box3 = new THREE.Box3();
    const size = new THREE.Vector3();
    const update = () => {
      const box = boxRef.current;
      const bar = barRef.current;
      if (!box || !bar || !app.field.boundsOf(selectedId, box3) || box3.isEmpty()) return;
      const { minX, minY, maxX, maxY } = screenBox(app, box3);
      const rect = app.rect;
      const pad = 6;
      box.style.transform = `translate(${(minX - pad).toFixed(1)}px, ${(minY - pad).toFixed(1)}px)`;
      box.style.width = `${(maxX - minX + pad * 2).toFixed(1)}px`;
      box.style.height = `${(maxY - minY + pad * 2).toFixed(1)}px`;
      box3.getSize(size);
      if (labelRef.current) labelRef.current.textContent = `${size.y.toFixed(2)} m tall`;
      const barW = bar.offsetWidth;
      const barH = bar.offsetHeight;
      const cx = Math.min(rect.width - barW / 2 - 12, Math.max(barW / 2 + 12, (minX + maxX) / 2));
      const below = maxY + pad + 34 + barH < rect.height - 120;
      const y = below ? maxY + pad + 30 : minY - pad - barH - 12;
      bar.style.transform = `translate(${(cx - barW / 2).toFixed(1)}px, ${Math.max(8, y).toFixed(1)}px)`;
    };
    update();
    return app.engine.onBeforeRender(update);
  }, [app, selectedId]);

  if (!selectedId || !friend) return null;
  return (
    <>
      <div className="select-box" ref={boxRef} aria-hidden="true">
        <i className="h tl" /><i className="h tr" /><i className="h bl" /><i className="h br" />
        <span className="select-label" ref={labelRef} />
      </div>
      <div className="creature-bar" ref={barRef} role="toolbar" aria-label={`Selected ${LABELS[friend.kind]}${friend.name ? ` ${friend.name}` : ''}`} data-kind={friend.kind}>
        <NameField key={friend.id} app={app} friend={friend} />
        <button className="chip" data-action="bubble-up" title="Bubble up (B)" onClick={() => app.bubbleUp()}>
          <Icon name="bubble" /> Bubble up
        </button>
        <span className="sep" />
        <button className="icon-btn" data-action="remove" title="Remove (Delete)" aria-label="Remove" onClick={() => app.remove()}>
          <Icon name="trash" />
        </button>
      </div>
    </>
  );
}
