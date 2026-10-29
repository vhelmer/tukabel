import {
  BlurFilter,
  CanvasTextMetrics,
  Container,
  Graphics,
  NineSliceSprite,
  Rectangle,
  Sprite,
  Text,
} from 'pixi.js';
import type { FederatedPointerEvent, Texture } from 'pixi.js';
import type { GameContent, GameState } from './types';
import type { Bounds } from './transforms';
import { contains, sceneFrame } from './hudLayout';
import { canTravel } from './state';
import { containsPolygon, polygonBounds } from './polygon';
import { worldMapPolygon } from './worldMap';
import type { Point } from './transforms';
import { hudArt } from './hudArt';
import type { AlphaMask } from './hitTest';

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
  map?: boolean;
  menu: boolean;
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
  polygon?: readonly Point[];
}
export interface HudLayout {
  width: number;
  height: number;
  controls: HudControl[];
  inventory: Bounds;
  book?: Bounds;
  map?: Bounds;
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
  blocksPointer: (clientX: number, clientY: number) => boolean;
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
  shelfMask: AlphaMask,
) {
  const root = new Container({ label: 'game-hud' });
  const panels = root.addChild(new Container());
  const effects = root.addChild(new Container());
  effects.eventMode = 'none';
  let snapshot = initial;
  let width = 1,
    height = 1;
  let inventoryPage = 0,
    journalScroll = 0,
    journalMaxScroll = 0;
  let focused: string | null = null;
  const controlArt = new Map<string, Container>();
  let layout: HudLayout = {
    width,
    height,
    controls: [],
    inventory: { x: 0, y: 0, width: 0, height: 0 },
  };
  const tooltip = root.addChild(new Container());
  tooltip.eventMode = 'none';
  let hoverId: string | null = null;
  let mapShade: Graphics | null = null;
  let mapShadeFrame: Bounds | null = null;
  let shadePolygon: readonly Point[] | null = null;
  let shadeAlpha = 0;
  let shadeTarget = 0;
  let shelfBounds: Bounds | null = null;
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
  function art(parent: Container, url: string, bounds: Bounds) {
    const sprite = parent.addChild(new Sprite(textures.get(url)!));
    sprite.position.set(bounds.x, bounds.y);
    sprite.width = bounds.width;
    sprite.height = bounds.height;
    sprite.eventMode = 'none';
    return sprite;
  }
  function shelfContains(x: number, y: number) {
    const b = shelfBounds;
    if (!b || !contains(b, x, y)) return false;
    // Invert the same nine-slice stretch used by the timber sprite: its carved
    // ends keep their proportions, only the middle plank changes length.
    const scale = b.height / 116;
    const localX = (x - b.x) / scale,
      localWidth = b.width / scale;
    const sourceX =
      localX < 70
        ? localX
        : localX >= localWidth - 90
          ? 900 - (localWidth - localX)
          : 70 + ((localX - 70) / Math.max(1, localWidth - 160)) * 740;
    const px = Math.min(
      shelfMask.width - 1,
      Math.floor((sourceX / 900) * shelfMask.width),
    );
    const py = Math.floor(((y - b.y) / b.height) * shelfMask.height);
    return shelfMask.alpha[py * shelfMask.width + px]! >= 32;
  }
  function syncTooltip() {
    tooltip
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    const control = layout.controls.find((c) => c.id === (hoverId ?? focused));
    selectMapSpotlight(
      snapshot.map && !control?.disabled ? control : undefined,
    );
    if (snapshot.journal || snapshot.menu || snapshot.drag) return;
    if (!control || control.disabled) return;
    if (snapshot.map) {
      const point = snapshot.content.worldMap?.points.find(
        (point) => control.id === 'map-point:' + point.id,
      );
      if (point) drawMapSign(control.bounds, point.label);
      return;
    }
    const title = text(
      tooltip,
      control.label,
      0,
      0,
      13,
      0xffedbd,
      Math.min(200, width - 30),
    );
    title.style.stroke = { color: 0x211c22, width: 4, join: 'round' };
    title.position.set(
      Math.max(
        8,
        Math.min(
          width - title.width - 8,
          control.bounds.x + control.bounds.width / 2 - title.width / 2,
        ),
      ),
      control.bounds.y + control.bounds.height + 9,
    );
  }
  function selectMapSpotlight(control?: HudControl) {
    if (!mapShade || !mapShadeFrame) return;
    const polygon = control?.polygon;
    const target = polygon ? 0.6 : 0;
    if (shadeTarget === target && (!polygon || polygon === shadePolygon))
      return;
    if (polygon && polygon !== shadePolygon) {
      const b = mapShadeFrame;
      mapShade
        .clear()
        .rect(b.x, b.y, b.width, b.height)
        .fill(0x000000)
        .poly(polygon.flatMap((p) => [p.x, p.y]))
        .cut();
      shadePolygon = polygon;
    }
    shadeTarget = target;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shadeAlpha = shadeTarget;
      mapShade.alpha = shadeAlpha;
      mapShade.visible = shadeAlpha > 0;
    }
    syncPlayback();
  }
  function drawMapSign(bounds: Bounds, label: string) {
    const map = layout.map!;
    const title = text(
      tooltip,
      label,
      0,
      0,
      16,
      0xffedbd,
      Math.max(1, Math.min(190, map.width - 64)),
    );
    const w = Math.min(map.width - 16, Math.max(132, title.width + 48));
    const h = Math.min(map.height - 16, Math.max(72, title.height + 32));
    const x = Math.max(
      map.x + 8,
      Math.min(map.x + map.width - w - 8, bounds.x + bounds.width / 2 - w / 2),
    );
    const y = Math.max(
      map.y + 42,
      Math.min(map.y + map.height - h - 8, bounds.y - h - 8),
    );
    const scale = h / 92;
    const board = new NineSliceSprite({
      texture: textures.get(hudArt.tag)!,
      leftWidth: 30,
      rightWidth: 30,
      topHeight: 0,
      bottomHeight: 0,
      width: w / scale,
      height: 92,
    });
    board.position.set(x, y);
    board.scale.set(scale);
    board.eventMode = 'none';
    tooltip.addChildAt(board, 0);
    const glow = new Graphics();
    for (let spread = 20; spread >= 0; spread -= 4)
      glow
        .roundRect(
          x - spread,
          y + h * 0.18 - spread,
          w + spread * 2,
          h * 0.72 + spread * 2,
          12 + spread,
        )
        .fill({ color: 0xffcf73, alpha: 0.045 });
    glow.blendMode = 'add';
    glow.eventMode = 'none';
    tooltip.addChildAt(glow, 0);
    const titleScale = Math.min(
      1,
      (w - 32) / title.width,
      (h * 0.5) / title.height,
    );
    title.scale.set(titleScale);
    title.style.stroke = { color: 0x36271e, width: 2, join: 'round' };
    title.position.set(
      x + (w - title.width) / 2,
      y + h * 0.55 - title.height / 2,
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
  function button(
    control: HudControl,
    label = control.label,
    size = 14,
    skin: 'tag' | 'slot' | 'notebook' | 'region' = 'tag',
  ) {
    layout.controls.push(control);
    const c = panels.addChild(new Container());
    const b = control.bounds;
    c.position.set(b.x, b.y);
    c.hitArea = control.polygon
      ? {
          contains: (x: number, y: number) =>
            containsPolygon(control.polygon!, { x: x + b.x, y: y + b.y }),
        }
      : new Rectangle(0, 0, b.width, b.height);
    c.eventMode = 'static';
    c.cursor = control.disabled ? 'default' : 'pointer';
    const bg =
      skin === 'region'
        ? null
        : art(
            c,
            skin === 'slot'
              ? hudArt.slot
              : skin === 'notebook'
                ? hudArt.notebook
                : hudArt.tag,
            { x: 0, y: 0, width: b.width, height: b.height },
          );
    // The selected item glows inside its pocket instead of a floor shadow.
    if (skin === 'slot' && control.pressed)
      c.addChild(
        new Graphics()
          .roundRect(4, 4, b.width - 8, b.height - 8, 6)
          .fill({ color: 0xf2cf80, alpha: 0.18 })
          .stroke({ width: 3, color: 0xf2cf80 }),
      ).eventMode = 'none';
    controlArt.set(control.id, c);
    if (label) {
      const caption = text(c, label, 0, 0, size);
      if (caption.width > Math.max(1, b.width - 10))
        caption.scale.set(Math.max(1, b.width - 10) / caption.width);
      caption.position.set(
        (b.width - caption.width) / 2,
        (b.height - caption.height) / 2,
      );
    }
    if (control.disabled) c.alpha = 0.45;
    c.on('pointerover', (event: FederatedPointerEvent) => {
      if (event.pointerType === 'touch') return;
      hoverId = control.id;
      if (bg) bg.tint = 0xffe2b3;
      syncTooltip();
      render();
    });
    c.on('pointerout', () => {
      hoverId = null;
      if (bg) bg.tint = 0xffffff;
      syncTooltip();
      render();
    });
    let origin: { x: number; y: number; id: number } | null = null;
    c.on('pointerdown', (e: FederatedPointerEvent) => {
      e.stopPropagation();
      // A compatibility mousedown after touch would blur the modal's initial focus.
      if (e.pointerType === 'touch') e.preventDefault();
      if (control.disabled) return;
      if (skin === 'region') {
        hoverId = control.id;
        syncTooltip();
        render();
      }
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
      return parent.addChild(view);
    }
    const glyph = text(
      parent,
      icon,
      box.x,
      box.y,
      Math.min(box.width, box.height) * 0.7,
    );
    glyph.position.set(
      box.x + (box.width - glyph.width) / 2,
      box.y + (box.height - glyph.height) / 2,
    );
    return glyph;
  }
  function drawFocus() {
    for (const control of layout.controls) {
      const view = controlArt.get(control.id);
      if (view)
        view.tint =
          control.id === focused && !control.disabled ? 0xffedc7 : 0xffffff;
    }
  }
  function rebuild() {
    const wasFading = shadeAlpha !== shadeTarget;
    mapShade = null;
    mapShadeFrame = null;
    shadePolygon = null;
    shadeAlpha = shadeTarget = 0;
    if (wasFading) syncPlayback();
    // Destroyed controls cannot emit pointerout. Never retain their tooltip
    // when opening a menu, dropping an item or moving between dialogue phases.
    hoverId = null;
    controlArt.clear();
    panels
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    const scene = snapshot.content.scenes.find(
      (s) => s.id === snapshot.state.sceneId,
    )!;
    const frame = sceneFrame(width, height, scene);
    if (snapshot.map && snapshot.content.worldMap) {
      shelfBounds = null;
      layout = {
        width,
        height,
        controls: [],
        inventory: { x: 0, y: 0, width: 0, height: 0 },
      };
      drawMap();
      drawFocus();
      syncTooltip();
      callbacks.onLayout(layout);
      render();
      return;
    }
    const top = frame.y + 6;
    const compact = frame.width < 600;
    const leading = compact ? 94 : 0;
    const desiredWidth = compact
      ? Math.max(220, 150 + snapshot.state.inventory.length * 60)
      : Math.max(310, 100 + snapshot.state.inventory.length * 68);
    const inventoryWidth = Math.max(
      75,
      Math.min(700, desiredWidth, frame.width - (compact ? 80 : 180)),
    );
    const inventory = {
      x: frame.x + 8,
      y: top,
      width: inventoryWidth,
      height: compact ? 60 : 78,
    };
    layout = { width, height, controls: [], inventory };
    shelfBounds = inventory;
    const shelfScale = inventory.height / 116;
    const shelf = panels.addChild(
      new NineSliceSprite({
        texture: textures.get(hudArt.tray)!,
        leftWidth: 70,
        rightWidth: 90,
        topHeight: 0,
        bottomHeight: 0,
        width: inventory.width / shelfScale,
        height: 116,
      }),
    );
    shelf.position.set(inventory.x, inventory.y);
    shelf.scale.set(shelfScale);
    shelf.eventMode = 'static';
    shelf.hitArea = {
      contains: (x: number, y: number) =>
        shelfContains(
          inventory.x + x * shelfScale,
          inventory.y + y * shelfScale,
        ),
    };
    const blocked = Boolean(
      snapshot.state.dialogue ||
      snapshot.menu ||
      snapshot.journal ||
      snapshot.map,
    );
    const active = Object.values(snapshot.state.tasks).filter(
      (status) => status === 'active',
    ).length;
    const right = frame.x + frame.width - 6;
    const toolsX = compact ? inventory.x + 1 : right - 110;
    const toolsY = compact ? top : top + 4;
    const notebook = { x: right - 60, y: top - 2, width: 60, height: 72 };
    button(
      {
        id: 'journal',
        label: 'Denník ' + active,
        bounds: notebook,
        expanded: snapshot.journal,
      },
      '',
      14,
      'notebook',
    );
    if (active) {
      const badge = panels.addChild(
        new Graphics()
          .circle(notebook.x + 49, notebook.y + 12, 10)
          .fill(0x793f33)
          .stroke({ width: 2, color: 0xe0c994 }),
      );
      badge.eventMode = 'none';
      const count = text(panels, String(active), 0, notebook.y + 3, 12);
      count.x = notebook.x + 49 - count.width / 2;
    }
    button(
      {
        id: 'menu',
        label: 'Menu',
        bounds: { x: toolsX, y: toolsY, width: 44, height: 48 },
        expanded: snapshot.menu,
      },
      '≡',
      28,
    );
    // Every item sits in its own sunken pocket of the drawer.
    const pitch = compact ? 46 : 62;
    const slotSize = compact ? 40 : 52;
    const slotY = top + (compact ? 11 : 15);
    const slots = Math.max(
      1,
      Math.floor(
        (inventoryWidth -
          leading -
          (compact && snapshot.state.inventory.length <= 2 ? 36 : 72)) /
          pitch,
      ),
    );
    inventoryPage = Math.max(
      0,
      Math.min(
        inventoryPage,
        Math.ceil(snapshot.state.inventory.length / slots) - 1,
      ),
    );
    const paged = snapshot.state.inventory.length > slots;
    const inset = leading + (paged ? 38 : 22);
    const trailing = paged ? 38 : 22;
    if (paged) {
      button(
        {
          id: 'inventory-prev',
          label: 'Predchádzajúce predmety',
          bounds: {
            x: inventory.x + leading,
            y: slotY + slotSize / 2 - 24,
            width: 36,
            height: 48,
          },
          disabled: inventoryPage === 0 || blocked,
        },
        '‹',
        26,
      );
      button(
        {
          id: 'inventory-next',
          label: 'Ďalšie predmety',
          bounds: {
            x: inventory.x + inventoryWidth - 36,
            y: slotY + slotSize / 2 - 24,
            width: 36,
            height: 48,
          },
          disabled:
            (inventoryPage + 1) * slots >= snapshot.state.inventory.length ||
            blocked,
        },
        '›',
        26,
      );
    }
    const visibleItems = snapshot.state.inventory.slice(
      inventoryPage * slots,
      (inventoryPage + 1) * slots,
    );
    const capacity = paged
      ? visibleItems.length
      : Math.max(
          visibleItems.length,
          Math.floor((inventoryWidth - inset - trailing) / pitch),
        );
    const slotWidth = Math.min(
      pitch,
      (inventoryWidth - inset - trailing) / Math.max(1, capacity),
    );
    const size = Math.min(slotSize, slotWidth - 4);
    const slotBox = (index: number) => ({
      x: inventory.x + inset + index * slotWidth + (slotWidth - size) / 2,
      y: slotY + (slotSize - size) / 2,
      width: size,
      height: size,
    });
    // Unused pockets stay visible and silent: an empty drawer needs no caption.
    for (let index = visibleItems.length; index < capacity; index++)
      art(panels, hudArt.slot, slotBox(index)).alpha = 0.8;
    visibleItems.forEach((id, index) => {
      const item = snapshot.content.items.find((i) => i.id === id)!;
      const b = slotBox(index);
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
        14,
        'slot',
      );
      const pad = Math.round(size * 0.15);
      const icon = image(c, item.image, item.icon, {
        x: pad,
        y: pad,
        width: b.width - pad * 2,
        height: b.height - pad * 2,
      });
      // The pocket stays while its item is being dragged out of it.
      if (snapshot.drag?.id === id) icon.alpha = 0.35;
      if (
        snapshot.drag?.target?.type === 'item' &&
        snapshot.drag.target.id === id &&
        snapshot.drag.id !== id
      )
        c.addChild(
          new Graphics()
            .roundRect(2, 2, b.width - 4, b.height - 4, 7)
            .stroke({ width: 3, color: 0xc7e597 }),
        ).eventMode = 'none';
    });
    if (snapshot.journal) drawBook();
    drawFocus();
    syncTooltip();
    callbacks.onLayout(layout);
    render();
  }
  function drawMap() {
    const map = snapshot.content.worldMap!;
    const scene = snapshot.content.scenes.find(
      (s) => s.id === snapshot.state.sceneId,
    )!;
    const frame = sceneFrame(width, height, scene);
    const b = {
      x: frame.x + 6,
      y: frame.y + 6,
      width: Math.max(1, frame.width - 12),
      height: Math.max(1, frame.height - 12),
    };
    const dim = panels.addChild(
      new Graphics()
        .rect(0, 0, width, height)
        .fill({ color: 0x100d15, alpha: 0.85 }),
    );
    dim.eventMode = 'static';
    const paper = panels.addChild(
      new Graphics()
        .roundRect(b.x, b.y, b.width, b.height, 12)
        .fill(0x30291e)
        .stroke({ color: 0xddbf7d, width: 3 }),
    );
    paper.eventMode = 'static';
    const area = {
      x: b.x + 8,
      y: b.y + 48,
      width: Math.max(1, b.width - 16),
      height: Math.max(1, b.height - 92),
    };
    const scale = Math.min(area.width / map.width, area.height / map.height);
    const imageFrame = {
      x: area.x + (area.width - map.width * scale) / 2,
      y: area.y + (area.height - map.height * scale) / 2,
      width: map.width * scale,
      height: map.height * scale,
    };
    art(panels, map.image, imageFrame);
    mapShade = panels.addChild(new Graphics());
    mapShadeFrame = imageFrame;
    const feather = new BlurFilter({ strength: 6, quality: 3 });
    // Keep the soft edge inside the map image, without blurring its artwork.
    feather.repeatEdgePixels = true;
    mapShade.filters = [feather];
    mapShade.filterArea = new Rectangle(
      imageFrame.x,
      imageFrame.y,
      imageFrame.width,
      imageFrame.height,
    );
    mapShade.once('destroyed', () => {
      feather.blurXFilter.destroy();
      feather.blurYFilter.destroy();
      feather.destroy();
    });
    mapShade.eventMode = 'none';
    mapShade.visible = false;
    mapShade.alpha = 0;
    layout.controls = [];
    layout.map = b;
    text(panels, 'Mapa okolia', b.x + 14, b.y + 10, 20);
    button(
      {
        id: 'map-close',
        label: 'Zavrieť mapu',
        bounds: { x: b.x + b.width - 48, y: b.y + 3, width: 44, height: 40 },
      },
      '×',
      24,
    );
    for (const point of map.points) {
      const unlocked = snapshot.state.unlockedScenes.includes(point.sceneId);
      const current = point.sceneId === snapshot.state.sceneId;
      const label = current
        ? `Tu si: ${point.label}`
        : !unlocked
          ? `Zamknuté: ${point.label}`
          : point.fastTravel === false
            ? `Iba prechodom: ${point.label}`
            : `Cestovať: ${point.label}`;
      const polygon = worldMapPolygon(point, map).map((p) => ({
        x: imageFrame.x + p.x * scale,
        y: imageFrame.y + p.y * scale,
      }));
      const bounds = polygonBounds(polygon);
      const view = button(
        {
          id: 'map-point:' + point.id,
          label,
          bounds,
          polygon,
          disabled: !canTravel(snapshot.content, snapshot.state, point.sceneId),
          pressed: current,
        },
        '',
        13,
        'region',
      );
      if (current) view.alpha = 1;
    }
    text(
      panels,
      'Zamknuté miesta a miesta iba prechodom nie sú dostupné na rýchlu cestu.',
      b.x + 12,
      b.y + b.height - 35,
      Math.max(9, Math.min(12, b.width / 65)),
      0xe7d6ae,
      b.width - 24,
    );
  }
  function drawBook() {
    const dim = panels.addChild(
      new Graphics()
        .rect(0, 0, width, height)
        .fill({ color: 0x100d15, alpha: 0.7 }),
    );
    dim.eventMode = 'static';
    dim.on('pointertap', () => callbacks.onAction('journal-close', true));
    const bw = Math.max(
        1,
        Math.min(590, width - 16, ((height - 16) * 620) / 650),
      ),
      bh = (bw * 650) / 620;
    const b = {
      x: (width - bw) / 2,
      y: (height - bh) / 2,
      width: bw,
      height: bh,
    };
    const left = b.x + bw * 0.12,
      right = b.x + bw * 0.91;
    const contentTop = b.y + bh * 0.25,
      contentBottom = b.y + bh * 0.83;
    const fontSize = Math.max(13, Math.min(20, bw / 26));
    layout.book = b;
    const paper = art(panels, hudArt.journal, b);
    paper.eventMode = 'static';
    paper.on('pointertap', (e) => e.stopPropagation());
    text(
      panels,
      'ZÁPISKY PRE PRÍPAD AMNÉZIE',
      left,
      b.y + bh * 0.065,
      Math.max(7, Math.min(10, bw / 48)),
      0x80513b,
    );
    const title = text(
      panels,
      'Môj pochybný plán',
      left,
      b.y + bh * 0.11,
      Math.min(28, bw / 17),
      0x392920,
    );
    if (title.width > right - left - 44)
      title.scale.set((right - left - 44) / title.width);
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
      left,
      b.y + bh * 0.19,
      Math.min(12, bw / 28),
      0x78533d,
    );
    layout.controls = [];
    button(
      {
        id: 'journal-close',
        label: 'Zavrieť denník',
        bounds: { x: right - 40, y: b.y + bh * 0.08, width: 40, height: 44 },
      },
      '×',
      25,
    );
    const page = panels.addChild(new Container());
    const mask = panels.addChild(
      new Graphics()
        .rect(left, contentTop, right - left, contentBottom - contentTop)
        .fill(0xffffff),
    );
    mask.eventMode = 'none';
    page.mask = mask;
    let rowY = contentTop + 3 - journalScroll;
    const entries = (snapshot.content.tasks ?? []).filter((task) =>
      Object.hasOwn(snapshot.state.tasks, task.id),
    );
    if (!entries.length)
      text(
        page,
        'Zatiaľ nemám nič zapísané.\nTo je samo osebe podozrivé.',
        left + 4,
        rowY + 12,
        fontSize,
        0x82634d,
        right - left - 8,
      );
    for (const task of entries) {
      const done = snapshot.state.tasks[task.id] === 'completed';
      text(
        page,
        done ? '✓' : '○',
        left + 2,
        rowY + 4,
        fontSize,
        done ? 0x526045 : 0x723c2f,
      );
      const label = text(
        page,
        task.text,
        left + 26,
        rowY + 4,
        fontSize,
        done ? 0x71614d : 0x392920,
        right - left - 30,
      );
      const metrics = CanvasTextMetrics.measureText(task.text, label.style);
      const lines = page.addChild(new Graphics());
      lines.eventMode = 'none';
      if (done)
        metrics.lineWidths.forEach((lineWidth, i) => {
          const y =
            rowY + 5 + metrics.lineHeight * i + metrics.lineHeight * 0.48;
          lines
            .moveTo(left + 25, y)
            .lineTo(left + 26 + lineWidth, y - 1)
            .stroke({ color: 0x8c4534, width: 2 });
        });
      rowY += Math.max(38, label.height + 20);
      lines
        .moveTo(left, rowY - 4)
        .lineTo(right, rowY - 4)
        .stroke({ color: 0x805f3d, alpha: 0.25, width: 1 });
    }
    journalMaxScroll = Math.max(0, rowY + journalScroll - contentBottom);
    if (journalScroll > journalMaxScroll) {
      page.y += journalScroll - journalMaxScroll;
      journalScroll = journalMaxScroll;
    }
    if (journalMaxScroll > 0) {
      button(
        {
          id: 'journal-up',
          label: 'Posunúť denník nahor',
          bounds: { x: right - 94, y: b.y + bh * 0.85, width: 44, height: 44 },
          disabled: journalScroll === 0,
        },
        '↑',
        20,
      );
      button(
        {
          id: 'journal-down',
          label: 'Posunúť denník nadol',
          bounds: { x: right - 44, y: b.y + bh * 0.85, width: 44, height: 44 },
          disabled: journalScroll >= journalMaxScroll,
        },
        '↓',
        20,
      );
    }
    if (bw > 370 || journalMaxScroll === 0)
      text(
        panels,
        'Nestratiť. Nezjesť. Nezabudnúť.',
        left,
        b.y + bh * 0.9,
        bw < 370 ? 8 : 10,
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
  function canvasPoint(clientX: number, clientY: number) {
    const b = canvas.getBoundingClientRect();
    return {
      x: ((clientX - b.x) * width) / b.width,
      y: ((clientY - b.y) * height) / b.height,
    };
  }
  const controller: HudController = {
    blocksPointer(clientX, clientY) {
      const p = canvasPoint(clientX, clientY);
      return (
        snapshot.journal ||
        snapshot.map ||
        snapshot.menu ||
        layout.controls.some((c) =>
          c.polygon
            ? containsPolygon(c.polygon, p)
            : contains(c.bounds, p.x, p.y),
        ) ||
        shelfContains(p.x, p.y)
      );
    },
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
      syncTooltip();
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
      return flights.length > 0 || shadeAlpha !== shadeTarget;
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
        next.state.unlockedScenes,
        next.content.worldMap,
        next.map,
        next.state.dialogue,
        next.selectedItem,
        next.menu,
        next.journal,
        next.drag?.id,
        next.drag?.target,
      ]);
      const wasJournal = snapshot.journal;
      snapshot = next;
      effects.visible = !next.journal && !next.map && !next.menu;
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
      shadeAlpha = shadeTarget;
      if (mapShade) {
        mapShade.alpha = shadeAlpha;
        mapShade.visible = shadeAlpha > 0;
      }
      for (const flight of flights) flight.view.destroy({ children: true });
      flights.length = 0;
      callbacks.onEffects({ dragging: Boolean(snapshot.drag), pickups: 0 });
      render();
    },
    animate(deltaMs: number) {
      if (mapShade && shadeAlpha !== shadeTarget) {
        const step = (Math.max(0, deltaMs) / 180) * 0.6;
        shadeAlpha =
          shadeTarget > shadeAlpha
            ? Math.min(shadeTarget, shadeAlpha + step)
            : Math.max(shadeTarget, shadeAlpha - step);
        mapShade.alpha = shadeAlpha;
        mapShade.visible = shadeAlpha > 0;
      }
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
