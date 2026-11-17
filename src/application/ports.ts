/** Produced from an explicit observation whitelist. Never pass an entire world here. */
export interface VisibleOutcome {
  readonly summary: string;
  readonly facts: readonly { readonly factId: string; readonly description: string }[];
}

export type PortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: 'not_implemented' | 'timeout' | 'cancelled' | 'provider_error' | 'invalid_output' | 'storage_error' };

export type ActionReply =
  | { readonly ok: false; readonly code: string }
  | { readonly ok: true; readonly committedRevision: number; readonly replayed: boolean;
      readonly outcome: VisibleOutcome; readonly clock: VisibleClock; readonly inspectTargets: readonly VisibleTarget[];
      readonly contactTarget?: VisibleTarget | null;
      readonly searchTargets?: readonly VisibleTarget[];
      readonly doorTargets?: readonly VisibleTarget[];
      readonly pickupTargets?: readonly VisibleTarget[];
      readonly inventory?: VisibleInventory | null;
      readonly sceneContext?: VisibleSceneContext | null;
      readonly playerStatus?: VisiblePlayerStatus;
      readonly currentLocation?: VisibleTarget | null; readonly routes?: readonly VisibleTarget[];
      readonly persistence: PortResult<{ readonly saveId: string; readonly worldRevision: number }> };

/** Only this command capability may be handed to a future UI. No truth accessors. */
export interface GameClient {
  dispatch(input: unknown): Promise<ActionReply>;
}

export interface VisibleClock {
  readonly worldRevision: number;
  readonly gameClockMinutes: number;
  readonly label: string;
}
export interface VisibleTarget {
  readonly targetId: string;
  readonly label: string;
}
export type VisibleInventory = readonly { readonly itemId: string; readonly label: string; readonly count: number; readonly weightKg: number }[];
export interface VisibleSceneContext {
  readonly scene: 'abandoned-residential-building-v1';
  readonly locationId: string;
  readonly locationRole: 'room' | 'corridor';
  readonly light: 'clear' | 'dim';
}
/** Public self-status only; neither world access nor a state mutation capability. */
export interface VisiblePlayerStatus {
  readonly hp: number;
  readonly stamina: number;
  readonly mental: number;
  readonly hunger: number;
  readonly thirst: number;
  readonly fatigue: number;
  readonly infection: number;
  readonly pain: number;
  readonly bodyTempC: number;
  readonly carryWeightKg: number;
}
export interface ObservationView {
  readonly contactTarget?: VisibleTarget | null;
  readonly sceneContext: VisibleSceneContext | null;
  readonly pickupTargets: readonly VisibleTarget[];
  readonly inventory: VisibleInventory | null;
  readonly doorTargets: readonly VisibleTarget[];
  readonly playerStatus: VisiblePlayerStatus | null;
  readonly searchTargets: readonly VisibleTarget[];
  readonly currentLocation: VisibleTarget | null;
  readonly routes: readonly VisibleTarget[];
  readonly phase: 'idle' | 'pending' | 'success' | 'error';
  readonly draft: string;
  readonly clock: VisibleClock;
  readonly entries: readonly VisibleOutcome[];
  readonly message: string;
  readonly canRetry: boolean;
  readonly inspectTargets: readonly VisibleTarget[];
}
export interface ObservationSession {
  greet?(): Promise<void>;
  readonly history?: HistoryClient;
  read(): ObservationView;
  subscribe(listener: (view: ObservationView) => void): () => void;
  setDraft(text: string): void;
  observe(): Promise<void>;
  observeDoorGap(targetId: string): Promise<void>;
  pickUp(itemId: string): Promise<void>;
  move(targetId: string): Promise<void>;
  search(targetId: string): Promise<void>;
  inspect(targetId: string): Promise<void>;
  submitText(): Promise<void>;
  retry(): Promise<void>;
}

export interface HistoryEntry { readonly timeLabel: string; readonly summary: string }
export interface HistoryPage {
  readonly page: number; readonly pages: number; readonly total: number;
  readonly from: number; readonly to: number;
  readonly canEarlier: boolean; readonly canNewer: boolean;
  readonly entries: readonly HistoryEntry[];
}
/** Only visible historical facts; no commands, storage or world access. */
export interface HistoryClient {
  read(): HistoryPage;
  selectPage(page: unknown): void;
  subscribe(listener: (page: HistoryPage) => void): () => void;
}

export interface CallContext {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export const bootstrapNotice = '当前居民楼原型支持原地观察、观察门缝、搜索房间、检查或拾取已发现的地面物品，以及在房间与走廊之间移动。本地解释能力有限，尚未接入 AI；刷新页面会丢失进度。';

/** Public self-profile contract. No world identity, tables, or journal is exposed. */
export interface CharacterProfile {
  readonly profile: { readonly name: string; readonly age: number; readonly gender: string; readonly occupation: string;
    readonly locationBackground: string; readonly bodyCondition: string; readonly personality: string;
    readonly strengths: string; readonly weaknesses: string; readonly importantItems: string; readonly companions: string;
    readonly importantPerson: string; readonly fear: string; readonly wish: string };
  readonly skills: { readonly perception: number; readonly stealth: number; readonly survival: number };
}
export interface CharacterDraft {
  readonly profile: { readonly [K in keyof CharacterProfile['profile']]: string };
  readonly skills: { readonly [K in keyof CharacterProfile['skills']]: string };
}
export interface CharacterPreview {
  readonly character: CharacterProfile;
  readonly stats: Readonly<{ hp: number; stamina: number; mental: number; hunger: number; thirst: number; fatigue: number;
    infection: number; pain: number; bodyTempC: number; carryWeightKg: number }>;
  readonly locationLabel: string;
  readonly clockLabel: string;
}
export interface StartedGame { readonly session: ObservationSession; readonly character: CharacterProfile | null }
export type ManualSlotId = 'manual-1' | 'manual-2' | 'manual-3';
export interface ManualSlotSummary {
  readonly id: ManualSlotId;
  readonly label: string;
  readonly status: 'unchecked' | 'empty' | 'saved' | 'error';
  readonly description: string;
}
export interface ImportFile { readonly size: number; arrayBuffer(): Promise<ArrayBuffer> }
export interface ImportView { readonly kind?: 'empty' | 'replace'; readonly phase: 'idle' | 'reading' | 'confirm' | 'writing' | 'imported' | 'error' | 'unknown'; readonly slotId: ManualSlotId | null; readonly message: string }
export interface RecoveryView { readonly phase: 'idle' | 'checking' | 'confirm' | 'recovering' | 'recovered' | 'error' | 'unknown'; readonly slotId: ManualSlotId | null; readonly message: string; readonly conversion?: 'v1-to-v2' }
export interface PersistenceView {
  readonly migration?: MigrationView;
  readonly originals?: OriginalsView;
  readonly canCheckMigration?: boolean;
  readonly canConfirmMigration?: boolean;
  readonly canCancelMigration?: boolean;
  readonly canListOriginals?: boolean;
  readonly canExportOriginal?: boolean;
  readonly recovery: RecoveryView;
  readonly canCheckPrevious: boolean;
  readonly canConfirmRecovery: boolean;
  readonly canCancelRecovery: boolean;
  readonly import: ImportView;
  readonly canImport: boolean;
  readonly canConfirmImport: boolean;
  readonly canCancelImport: boolean;
  readonly export: { readonly phase: 'idle' | 'reading' | 'initiated' | 'error'; readonly message: string; readonly slotId: ManualSlotId | null };
  readonly canExport: boolean;
  readonly autosave: { readonly mode: 'off' | 'on' | 'saving' | 'paused'; readonly slotId: ManualSlotId | null; readonly message: string };
  readonly canEnableAutosave: boolean;
  readonly canDisableAutosave: boolean;
  readonly selectedSlot: ManualSlotId;
  readonly slots: readonly ManualSlotSummary[];
  readonly currentDescription: string;
  readonly savedToSelected: boolean;
  readonly confirmationLabel: string | null;
  readonly canSelect: boolean;
  readonly canRefresh: boolean;
  readonly phase: 'idle' | 'saving' | 'loading' | 'saved' | 'error' | 'confirm';
  readonly message: string;
  readonly slotDescription: string;
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly canLoad: boolean;
  readonly confirmation: 'save' | 'load' | null;
}
/** Player-facing operations only: no snapshots, engines, returned file bodies or DB handles. */
export interface ManualPersistenceClient {
  checkMigration?(): Promise<void>;
  confirmMigration?(): Promise<void>;
  cancelMigration?(): void;
  listOriginals?(): Promise<void>;
  exportOriginal?(id:string): Promise<void>;
  checkPrevious(): Promise<void>;
  confirmRecovery(): Promise<void>;
  cancelRecovery(): void;
  prepareImport(file: ImportFile): Promise<void>;
  confirmImport(): Promise<void>;
  cancelImport(): void;
  exportSave(): Promise<void>;
  enableAutosave(): Promise<void>;
  disableAutosave(): void;
  select(slotId: ManualSlotId): void;
  read(): PersistenceView;
  subscribe(listener: (view: PersistenceView) => void): () => void;
  refresh(): Promise<void>;
  save(): Promise<void>;
  load(): Promise<StartedGame | null>;
  confirm(): Promise<StartedGame | null>;
  cancel(): void;
}
export interface MigrationView {readonly phase:'idle'|'checking'|'confirm'|'writing'|'completed'|'error'|'unknown';readonly slotId:ManualSlotId|null;readonly message:string}
export interface OriginalsView {readonly phase:'idle'|'reading'|'ready'|'initiated'|'error';readonly slotId:ManualSlotId|null;readonly message:string;readonly entries:readonly {readonly id:string;readonly label:string}[]}
export interface CharacterCreationView {
  readonly phase: 'editing' | 'preview' | 'starting' | 'started' | 'error';
  readonly draft: CharacterDraft;
  readonly errors: readonly string[];
  readonly preview: CharacterPreview | null;
  readonly started: StartedGame | null;
}
export interface CharacterCreation {
  read(): CharacterCreationView;
  update(draft: CharacterDraft): void;
  preview(): void;
  edit(): void;
  cancel(): void;
  start(): StartedGame | null;
  startPrototype(): StartedGame | null;
}
export const characterFields = [
  ['name', '姓名'], ['age', '年龄'], ['gender', '性别'], ['occupation', '职业'], ['locationBackground', '所在地背景'],
  ['bodyCondition', '身体状况背景'], ['personality', '性格'], ['strengths', '擅长'], ['weaknesses', '不擅长'],
  ['importantItems', '末日前重要物品'], ['companions', '同伴'], ['importantPerson', '最重要的人'], ['fear', '恐惧'], ['wish', '愿望'],
] as const;
export const characterSkills = [['perception', '感知'], ['stealth', '潜行'], ['survival', '生存']] as const;
export const characterNotice = '背景资料会完整记录，目前不会自动生成地图、装备、伤病、同伴或其他人物，也不会改变数值。实际起点请见开始前预览；属性与技能是暂定的原型规则。进度仅在本页内存中，刷新会丢失，尚不能保存。';
