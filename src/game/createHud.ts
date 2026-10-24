import {
  CanvasTextMetrics,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
} from 'pixi.js';
import type { FederatedPointerEvent, Texture } from 'pixi.js';
import type { GameContent, GameState } from './types';
import type { Bounds } from './transforms';
import { contains, gameViewport } from './hudLayout';

export interface InventoryPointer {
  pointerId: number;
  button: number;
  clientX: number;
  clientY: number;
  element: HTMLCanvasElement;
}
export interface HudDrag {
  id: string;
  x: number;
  y: number;
  target: { type: 'item' | 'hotspot'; id: string } | null;
}
export interface HudState {
  content: GameContent;
  state: GameState;
  selectedItem: string | null;
  drag: HudDrag | null;
  journal: boolean;
  menu: boolean;
  objectsOpen: boolean;
}
export interface HudControl {
  id: string;
  label: string;
  bounds: Bounds;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  itemId?: string;
  image?: string;
}
export interface HudLayout {
  width: number;
  height: number;
  controls: HudControl[];
  inventory: Bounds;
  book?: Bounds;
}
export interface HudPickup {
  image?: string;
  icon: string;
  itemId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}
export interface HudCallbacks {
  onAction: (id: string, pointer: boolean) => void;
  onItemDown: (id: string, event: InventoryPointer) => void;
  onLayout: (layout: HudLayout) => void;
  onEffects: (effects: {
    dragging: boolean;
    pickups: number;
    pickupImage?: string;
  }) => void;
}
export interface HudController {
  itemAt: (clientX: number, clientY: number) => string | null;
  activate: (id: string) => void;
  focus: (id: string | null) => void;
  pickup: (pickup: HudPickup) => void;
}

// A small screen-space layer, not another scene or a second game state.
export function createHud(
  canvas: HTMLCanvasElement,
  textures: ReadonlyMap<string, Texture>,
  initial: HudState,
  callbacks: HudCallbacks,
  render: () => void,
  syncPlayback: () => void,
) {
  const root = new Container({ label: 'game-hud' });
  const panels = root.addChild(new Container());
  const effects = root.addChild(new Container());
  effects.eventMode = 'none';
  const focusRing = root.addChild(new Graphics());
  focusRing.eventMode = 'none';
  let snapshot = initial;
  let width = 1,
    height = 1;
  let inventoryPage = 0,
    journalScroll = 0,
    journalMaxScroll = 0;
  let focused: string | null = null;
  let layout: HudLayout = {
    width,
    height,
    controls: [],
    inventory: { x: 0, y: 0, width: 0, height: 0 },
  };
  let ghost: Container | null = null;
  let ghostId: string | null = null;
  let structuralKey = '';
  const flights: { view: Container; pickup: HudPickup; time: number }[] = [];

  function text(
    parent: Container,
    value: string,
    x: number,
    y: number,
    size = 14,
    color = 0xefdbaf,
    wrap?: number,
  ) {
    const view = new Text({
      text: value,
      style: {
        fontFamily: 'Georgia, serif',
        fontSize: size,
        fill: color,
        fontWeight: 'bold',
        wordWrap: wrap !== undefined,
        wordWrapWidth: wrap,
        breakWords: true,
        lineHeight: size * 1.45,
      },
    });
    view.position.set(x, y);
    view.eventMode = 'none';
    parent.addChild(view);
    return view;
  }
  function plate(
    parent: Container,
    box: Bounds,
    fill: number,
    edge = 0x987044,
  ) {
    return parent.addChild(
      new Graphics()
        .poly([
          box.x + 4,
          box.y,
          box.x + box.width - 5,
          box.y + 1,
          box.x + box.width,
          box.y + box.height - 5,
          box.x + box.width - 5,
          box.y + box.height,
          box.x + 2,
          box.y + box.height - 1,
          box.x,
          box.y + 5,
        ])
        .fill(fill)
        .stroke({ width: 2, color: edge }),
    );
  }
  function activate(id: string, pointer = false) {
    const control = layout.controls.find((c) => c.id === id);
    if (!control || control.disabled) return;
    if (id === 'inventory-prev' || id === 'inventory-next') {
      inventoryPage += id === 'inventory-prev' ? -1 : 1;
      rebuild();
    } else if (id === 'journal-up' || id === 'journal-down') {
      journalScroll = Math.max(
        0,
        Math.min(
          journalMaxScroll,
          journalScroll +
            (id === 'journal-up' ? -1 : 1) * Math.max(60, height * 0.35),
        ),
      );
      rebuild();
    } else callbacks.onAction(id, pointer);
  }
  function button(control: HudControl, label = control.label, size = 14) {
    layout.controls.push(control);
    const c = panels.addChild(new Container());
    const b = control.bounds;
    c.position.set(b.x, b.y);
    c.hitArea = new Rectangle(0, 0, b.width, b.height);
    c.eventMode = control.disabled ? 'none' : 'static';
    c.cursor = 'pointer';
    const bg = plate(
      c,
      { x: 0, y: 0, width: b.width, height: b.height },
      control.pressed || control.expanded ? 0x735736 : 0x38282a,
    );
    const caption = text(c, label, 0, 0, size);
    if (caption.width > b.width - 10)
      caption.scale.set((b.width - 10) / caption.width);
    caption.position.set(
      (b.width - caption.width) / 2,
      (b.height - caption.height) / 2,
    );
    if (control.disabled) c.alpha = 0.45;
    c.on('pointerover', () => {
      bg.tint = 0xffdda0;
      render();
    });
    c.on('pointerout', () => {
      bg.tint = 0xffffff;
      render();
    });
    let origin: { x: number; y: number; id: number } | null = null;
    c.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
      if (control.itemId)
        callbacks.onItemDown(control.itemId, {
          pointerId: e.pointerId,
          button: e.button,
          clientX: e.clientX,
          clientY: e.clientY,
          element: canvas,
        });
    });
    // pointerup works for mouse and touch, without depending on compatibility clicks.
    c.on('pointerup', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      const start = origin;
      origin = null;
      if (
        start &&
        start.id === e.pointerId &&
        e.button === 0 &&
        Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 7
      )
        activate(control.id, true);
    });
    c.on('pointerupoutside', () => {
      origin = null;
    });
    c.on('pointercancel', () => {
      origin = null;
    });
    return c;
  }
  function image(
    parent: Container,
    url: string | undefined,
    icon: string,
    box: Bounds,
  ) {
    const texture = url ? textures.get(url) : undefined;
    if (texture) {
      const view = new Sprite(texture);
      const scale = Math.min(
        box.width / texture.orig.width,
        box.height / texture.orig.height,
      );
      view.scale.set(scale);
      view.position.set(
        box.x + (box.width - view.width) / 2,
        box.y + (box.height - view.height) / 2,
      );
      view.eventMode = 'none';
      parent.addChild(view);
    } else
      text(
        parent,
        icon,
        box.x + 5,
        box.y,
        Math.min(box.width, box.height) * 0.7,
      );
  }
  function drawFocus() {
    focusRing.clear();
    const control = layout.controls.find((c) => c.id === focused);
    if (control && !control.disabled) {
      const b = control.bounds;
      focusRing
        .roundRect(b.x + 2, b.y + 2, b.width - 4, b.height - 4, 5)
        .stroke({ width: 3, color: 0xffe2a1 });
    }
  }
  function rebuild() {
    panels
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    layout = {
      width,
      height,
      controls: [],
      inventory: {
        x: 8,
        y: 55,
        width: Math.max(1, width - 16),
        height: gameViewport(width, height).y - 61,
      },
    };
    const top = gameViewport(width, height).y;
    const wood = panels.addChild(
      new Graphics().rect(0, 0, width, top).fill(0x38292a),
    );
    for (let y = 2; y < top; y += 12)
      wood
        .moveTo(0, y)
        .lineTo(width, y + 2)
        .stroke({ color: y % 3 ? 0x18121c : 0x9a7048, width: 1, alpha: 0.4 });
    wood
      .moveTo(0, top - 2)
      .lineTo(width, top - 2)
      .stroke({ width: 3, color: 0x916b48 });
    wood.eventMode = 'static';
    wood.hitArea = new Rectangle(0, 0, width, top);
    wood.on('pointerdown', (e) => e.stopPropagation());
    const blocked = Boolean(
      snapshot.state.dialogue || snapshot.menu || snapshot.journal,
    );
    const active = Object.values(snapshot.state.tasks).filter(
      (status) => status === 'active',
    ).length;
    const small = width < 600;
    const menuWidth = 58,
      objectsWidth = 75,
      bookWidth = 101;
    const start = width - menuWidth - objectsWidth - bookWidth - 24;
    const scene = snapshot.content.scenes.find(
      (s) => s.id === snapshot.state.sceneId,
    )!;
    const heading = text(
      panels,
      width > 850 ? '↯ TUKABEL   /   ' + scene.title : scene.title,
      12,
      15,
      small ? 12 : 15,
      0xd5b98f,
    );
    const headingWidth = Math.max(1, start - 22);
    if (heading.width > headingWidth)
      heading.scale.set(headingWidth / heading.width);
    button({
      id: 'journal',
      label: 'Denník ' + active,
      bounds: { x: start, y: 5, width: bookWidth, height: 44 },
      expanded: snapshot.journal,
    });
    button({
      id: 'objects',
      label: 'Objekty',
      bounds: {
        x: start + bookWidth + 5,
        y: 5,
        width: objectsWidth,
        height: 44,
      },
      expanded: snapshot.objectsOpen,
      disabled: blocked,
    });
    button({
      id: 'menu',
      label: 'Menu',
      bounds: { x: width - menuWidth - 7, y: 5, width: menuWidth, height: 44 },
      expanded: snapshot.menu,
    });
    const slotHeight = top - 62;
    const slots = Math.max(1, Math.floor((width - 112) / (small ? 112 : 155)));
    inventoryPage = Math.max(
      0,
      Math.min(
        inventoryPage,
        Math.ceil(snapshot.state.inventory.length / slots) - 1,
      ),
    );
    const paged = snapshot.state.inventory.length > slots;
    const offset = paged ? 54 : 10;
    if (!snapshot.state.inventory.length)
      text(panels, 'Prázdne vrecká. Zatiaľ.', 18, 64, 14, 0xbca482);
    if (paged) {
      button(
        {
          id: 'inventory-prev',
          label: 'Predchádzajúce predmety',
          bounds: { x: 4, y: 56, width: 44, height: slotHeight },
          disabled: inventoryPage === 0 || blocked,
        },
        '‹',
        28,
      );
      button(
        {
          id: 'inventory-next',
          label: 'Ďalšie predmety',
          bounds: { x: width - 48, y: 56, width: 44, height: slotHeight },
          disabled:
            (inventoryPage + 1) * slots >= snapshot.state.inventory.length ||
            blocked,
        },
        '›',
        28,
      );
    }
    const visibleItems = snapshot.state.inventory.slice(
      inventoryPage * slots,
      (inventoryPage + 1) * slots,
    );
    const slotWidth = Math.min(
      small ? 145 : 190,
      (width - offset * 2) / Math.max(1, visibleItems.length),
    );
    visibleItems.forEach((id, index) => {
      const item = snapshot.content.items.find((i) => i.id === id)!;
      const b = {
        x: offset + index * slotWidth,
        y: 56,
        width: slotWidth - 6,
        height: slotHeight,
      };
      const c = button(
        {
          id: 'item:' + id,
          itemId: id,
          label: item.label,
          image: item.image,
          bounds: b,
          disabled: blocked,
          pressed: snapshot.selectedItem === id,
        },
        '',
      );
      image(c, item.image, item.icon, {
        x: 4,
        y: 3,
        width: Math.min(42, slotHeight - 6),
        height: slotHeight - 6,
      });
      text(
        c,
        item.label,
        Math.min(50, slotHeight + 4),
        6,
        height < 420 ? 11 : 13,
        0xf3ddb0,
        Math.max(20, b.width - Math.min(54, slotHeight + 8)),
      );
      if (snapshot.drag?.id === id) c.alpha = 0.4;
      if (
        snapshot.drag?.target?.type === 'item' &&
        snapshot.drag.target.id === id &&
        snapshot.drag.id !== id
      )
        c.addChild(
          new Graphics()
            .roundRect(1, 1, b.width - 2, b.height - 2, 5)
            .stroke({ width: 3, color: 0xc7e597 }),
        ).eventMode = 'none';
    });
    if (snapshot.journal) drawBook();
    drawFocus();
    callbacks.onLayout(layout);
    render();
  }
  function drawBook() {
    const dim = panels.addChild(
      new Graphics()
        .rect(0, 0, width, height)
        .fill({ color: 0x100d15, alpha: 0.78 }),
    );
    dim.eventMode = 'static';
    dim.on('pointertap', () => callbacks.onAction('journal-close', true));
    const bw = Math.min(590, width - 24),
      bh = Math.min(570, height - 24);
    const b = {
      x: (width - bw) / 2,
      y: (height - bh) / 2,
      width: bw,
      height: bh,
    };
    layout.book = b;
    plate(
      panels,
      { x: b.x - 4, y: b.y + 5, width: bw + 3, height: bh },
      0x38252b,
      0x21191c,
    ).eventMode = 'none';
    const paper = plate(panels, b, 0xe4cda2, 0x593d2b);
    paper.eventMode = 'static';
    paper.on('pointertap', (e) => e.stopPropagation());
    const wear = panels.addChild(new Graphics());
    wear.eventMode = 'none';
    for (let i = 0; i < 18; i++) {
      const x = b.x + 8 + ((i * 79) % Math.max(1, Math.floor(bw - 16)));
      const y = b.y + (i % 2 ? bh - 7 - (i % 4) * 6 : 7 + (i % 4) * 4);
      wear
        .ellipse(x, y, 8 + (i % 13), 3 + (i % 5))
        .fill({ color: 0x855335, alpha: 0.07 });
    }
    wear
      .circle(b.x + bw - 27, b.y + bh - 40, 18)
      .stroke({ color: 0x8e6240, width: 3, alpha: 0.09 });
    const binding = panels.addChild(new Graphics());
    for (let y = b.y + 20; y < b.y + bh - 10; y += 32)
      binding
        .circle(b.x + 12, y, 3)
        .fill(0x453025)
        .moveTo(b.x + 5, y - 1)
        .lineTo(b.x + 18, y + 2)
        .stroke({ color: 0x997249, width: 2 });
    binding
      .moveTo(b.x + 26, b.y + 7)
      .lineTo(b.x + 26, b.y + bh - 7)
      .stroke({ color: 0x9a5447, alpha: 0.4, width: 1 });
    binding.eventMode = 'none';
    text(panels, 'ZÁPISKY PRE PRÍPAD AMNÉZIE', b.x + 37, b.y + 16, 9, 0x80513b);
    text(
      panels,
      'Môj pochybný plán',
      b.x + 36,
      b.y + 35,
      width < 450 ? 22 : 28,
      0x392920,
    );
    const remaining = Object.values(snapshot.state.tasks).filter(
      (s) => s === 'active',
    ).length;
    text(
      panels,
      remaining
        ? 'Ešte vybaviť: ' + remaining
        : Object.keys(snapshot.state.tasks).length
          ? 'Všetko odškrtnuté. Zatiaľ.'
          : 'Čakám na prvý dobrý nápad.',
      b.x + 37,
      b.y + 77,
      12,
      0x78533d,
    );
    // Only the modal's controls participate in keyboard navigation.
    layout.controls = [];
    button(
      {
        id: 'journal-close',
        label: 'Zavrieť denník',
        bounds: { x: b.x + bw - 51, y: b.y + 12, width: 40, height: 44 },
      },
      '×',
      25,
    );
    const page = panels.addChild(new Container());
    const mask = panels.addChild(
      new Graphics()
        .rect(b.x + 30, b.y + 107, bw - 45, Math.max(1, bh - 167))
        .fill(0xffffff),
    );
    mask.eventMode = 'none';
    page.mask = mask;
    let rowY = b.y + 110 - journalScroll;
    const entries = (snapshot.content.tasks ?? []).filter((task) =>
      Object.hasOwn(snapshot.state.tasks, task.id),
    );
    if (!entries.length)
      text(
        page,
        'Zatiaľ nemám nič zapísané.\nTo je samo osebe podozrivé.',
        b.x + 38,
        rowY + 12,
        18,
        0x82634d,
        bw - 65,
      );
    for (const task of entries) {
      const done = snapshot.state.tasks[task.id] === 'completed';
      text(
        page,
        done ? '✓' : '○',
        b.x + 37,
        rowY + 4,
        20,
        done ? 0x526045 : 0x723c2f,
      );
      const label = text(
        page,
        task.text,
        b.x + 64,
        rowY + 4,
        width < 450 ? 17 : 20,
        done ? 0x71614d : 0x392920,
        bw - 87,
      );
      const metrics = CanvasTextMetrics.measureText(task.text, label.style);
      const lines = page.addChild(new Graphics());
      lines.eventMode = 'none';
      if (done)
        metrics.lineWidths.forEach((lineWidth, i) => {
          const y =
            rowY + 5 + metrics.lineHeight * i + metrics.lineHeight * 0.48;
          lines
            .moveTo(b.x + 63, y)
            .lineTo(b.x + 64 + lineWidth, y - 1)
            .stroke({ color: 0x8c4534, width: 2 });
        });
      rowY += Math.max(46, label.height + 24);
      lines
        .moveTo(b.x + 37, rowY - 4)
        .lineTo(b.x + bw - 16, rowY - 4)
        .stroke({ color: 0x805f3d, alpha: 0.25, width: 1 });
    }
    journalMaxScroll = Math.max(0, rowY + journalScroll - (b.y + bh - 60));
    if (journalScroll > journalMaxScroll) {
      page.y += journalScroll - journalMaxScroll;
      journalScroll = journalMaxScroll;
    }
    if (journalMaxScroll > 0) {
      button(
        {
          id: 'journal-up',
          label: 'Posunúť denník nahor',
          bounds: {
            x: b.x + bw - 106,
            y: b.y + bh - 51,
            width: 44,
            height: 42,
          },
          disabled: journalScroll === 0,
        },
        '↑',
        20,
      );
      button(
        {
          id: 'journal-down',
          label: 'Posunúť denník nadol',
          bounds: { x: b.x + bw - 56, y: b.y + bh - 51, width: 44, height: 42 },
          disabled: journalScroll >= journalMaxScroll,
        },
        '↓',
        20,
      );
    }
    text(
      panels,
      'Nestratiť. Nezjesť. Nezabudnúť.',
      b.x + 37,
      b.y + bh - 30,
      width < 450 ? 9 : 11,
      0x956747,
    );
  }
  function syncGhost() {
    const drag = snapshot.drag;
    if (ghostId !== drag?.id) {
      ghost?.destroy({ children: true });
      ghost = null;
      ghostId = drag?.id ?? null;
      if (drag) {
        const item = snapshot.content.items.find((i) => i.id === drag.id)!;
        ghost = effects.addChild(new Container());
        image(ghost, item.image, item.icon, {
          x: -26,
          y: -26,
          width: 52,
          height: 52,
        });
        text(ghost, item.label, 24, 25, 13);
      }
    }
    if (ghost && drag) {
      ghost.position.set(drag.x, drag.y);
      ghost.alpha =
        drag.target &&
        !(drag.target.type === 'item' && drag.target.id === drag.id)
          ? 1
          : 0.7;
    }
  }
  const controller: HudController = {
    itemAt(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      const x = ((clientX - box.x) * width) / box.width,
        y = ((clientY - box.y) * height) / box.height;
      return (
        layout.controls.find(
          (c) => c.itemId && !c.disabled && contains(c.bounds, x, y),
        )?.itemId ?? null
      );
    },
    activate,
    focus(id) {
      focused = id;
      drawFocus();
      render();
    },
    pickup(pickup) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const view = effects.addChild(new Container());
      image(view, pickup.image, pickup.icon, {
        x: -pickup.width / 2,
        y: -pickup.height / 2,
        width: pickup.width,
        height: pickup.height,
      });
      view.position.set(
        pickup.x + pickup.width / 2,
        pickup.y + pickup.height / 2,
      );
      flights.push({ view, pickup, time: 0 });
      callbacks.onEffects({
        dragging: Boolean(snapshot.drag),
        pickups: flights.length,
        pickupImage: pickup.image,
      });
      syncPlayback();
    },
  };
  return {
    root,
    controller,
    get active() {
      return flights.length > 0;
    },
    resize(w: number, h: number) {
      width = w;
      height = h;
      rebuild();
    },
    update(next: HudState) {
      const key = JSON.stringify([
        next.state.inventory,
        next.state.tasks,
        next.state.dialogue,
        next.selectedItem,
        next.menu,
        next.journal,
        next.objectsOpen,
        next.drag?.id,
        next.drag?.target,
      ]);
      const wasJournal = snapshot.journal;
      snapshot = next;
      effects.visible = !next.journal && !next.menu;
      if (!wasJournal && next.journal) journalScroll = 0;
      if (key !== structuralKey) {
        structuralKey = key;
        rebuild();
      }
      syncGhost();
      callbacks.onEffects({
        dragging: Boolean(next.drag),
        pickups: flights.length,
        pickupImage: flights[0]?.pickup.image,
      });
      render();
    },
    resetEffects() {
      for (const flight of flights) flight.view.destroy({ children: true });
      flights.length = 0;
      callbacks.onEffects({ dragging: Boolean(snapshot.drag), pickups: 0 });
      render();
    },
    animate(deltaMs: number) {
      for (let i = flights.length - 1; i >= 0; i--) {
        const flight = flights[i]!;
        flight.time += deltaMs;
        const t = Math.min(1, flight.time / 680),
          ease = 1 - (1 - t) ** 3;
        const p = flight.pickup;
        const target =
          layout.controls.find((c) => c.itemId === p.itemId)?.bounds ??
          layout.inventory;
        const startX = p.x + p.width / 2,
          startY = p.y + p.height / 2;
        flight.view.position.set(
          startX + (target.x + target.width / 2 - startX) * ease,
          startY +
            (target.y + target.height / 2 - startY) * ease -
            Math.sin(t * Math.PI) * 26,
        );
        flight.view.scale.set(
          1 +
            Math.sin(t * Math.PI) * 0.12 -
            t * (1 - Math.min(1, 42 / Math.max(p.width, p.height))),
        );
        flight.view.rotation = ((p.rotation * Math.PI) / 180) * (1 - t);
        flight.view.alpha = 1 - t;
        if (t === 1) {
          flight.view.destroy({ children: true });
          flights.splice(i, 1);
        }
      }
      callbacks.onEffects({
        dragging: Boolean(snapshot.drag),
        pickups: flights.length,
        pickupImage: flights[0]?.pickup.image,
      });
      if (!flights.length) syncPlayback();
    },
  };
}
