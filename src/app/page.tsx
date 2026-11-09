'use client'

import { isSafeHttpUrl } from '@/lib/safe-url'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { scheduleInputError } from '@/lib/schedule-input'
import { NO_PROJECT_FILTER, PRIORITY_DOT, PRIORITY_LABEL, SCHEDULE_LABELS, cooldownColor, cooldownIcon, priorityDot, priorityLabel, projectFilterAfterAdd, projectIdForNewTask, scheduleLabel } from '@/lib/task-view'
import { attemptIsSettled, canonicalJson, cloneTaskDefaults, emptyTaskForm, isTaskFormDirty, nextSaveAttempt, readTaskDefaults, rememberTaskDefaults, taskDefaultsKey, taskFormSnapshot, type SaveAttempt, type TaskFormDefaults, type TaskFormSnapshot } from '@/lib/task-form'
import { showProjectOnCard, taskCardActions, taskCardStatusText } from '@/lib/task-card'
import { activeOnly, countDone, countForTab, tasksForTab } from '@/lib/task-counts'
import { refreshCachedTasks } from '@/lib/task-cache'

/* ===== Types ===== */
interface Note {
  id: string; content: string; color: string; pinned: boolean
  createdAt: string; updatedAt: string
}

interface Task {
  id: string; name: string; description: string | null; link: string | null
  scheduleType: string; scheduleConfig: string; notes: string | null; pinned: boolean
  priority?: string
  status: 'siap' | 'cooldown' | 'selesai'
  nextReadyAt: string | null; lastCompletedAt: string | null
  cooldownRemaining: string; cooldownMs: number
  project: { id: string; name: string; color: string } | null
  createdAt: string
  logCount?: number
}

interface Project {
  id: string; name: string; color: string; _count: { tasks: number }
}

interface Settings {
  timezone?: string; telegramId?: string; telegramName?: string
  telegramChatId?: string; telegramBotUsername?: string
  telegramNotifEnabled?: boolean; browserNotifEnabled?: boolean
  autoExpandSiap?: boolean; autoCompleteLink?: boolean
  notifyBeforeCooldownMin?: number; audioAlertEnabled?: boolean
  timeFormat?: string
}

type CompletionToken = { id: string; logId: string }

interface TaskTemplate {
  id: string; name: string; description: string | null; link: string | null
  scheduleType: string; scheduleConfig: string; priority: string
  createdAt: string; updatedAt: string
}

const SECTIONS: { status: 'siap' | 'cooldown' | 'selesai'; label: string; icon: string; color: string }[] = [
  { status: 'siap', label: 'Siap dikerjakan', icon: '✅', color: 'var(--win95-siap)' },
  { status: 'cooldown', label: 'Menunggu', icon: '⏳', color: '#6b6b00' },
  { status: 'selesai', label: 'Selesai', icon: '✔️', color: '#606060' },
]

const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const TZ_OPTIONS = [
  { value: 'WIB', label: 'WIB (UTC+7)' },
  { value: 'WITA', label: 'WITA (UTC+8)' },
  { value: 'WIT', label: 'WIT (UTC+9)' }
]
const PROJECT_COLORS = ['#000080', '#008000', '#800000', '#808000', '#800080', '#008080', '#FF6600', '#9900CC']

/* ===== Context menu viewport clamp — pre-position before render (rough estimate) ===== */
const clampPos = (x: number, y: number) => {
  if (typeof window === 'undefined') return { x, y }
  const pad = 8
  return { x: Math.min(Math.max(pad, x), window.innerWidth - pad), y: Math.min(Math.max(pad, y), window.innerHeight - pad) }
}

/* ===== Post-render viewport clamp — measures actual element, flips if needed ===== */
const clampElementToViewport = (el: HTMLElement | null) => {
  if (!el || typeof window === 'undefined') return
  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pad = 4
  let clamped = false
  // Flip right → left if overflowing right edge
  if (rect.right > vw - pad) {
    el.style.left = 'auto'
    el.style.right = pad + 'px'
    clamped = true
  }
  // Flip bottom → top (anchor to click Y) if overflowing bottom edge
  if (rect.bottom > vh - pad) {
    const top = vh - rect.height - pad
    // If still overflows from top, let CSS max-height + overflow-y handle it
    el.style.top = (top > pad ? top : pad) + 'px'
    clamped = true
  }
  // Re-measure after adjustments to handle cascading overflow
  if (clamped) {
    const r2 = el.getBoundingClientRect()
    if (r2.right > vw - pad && el.style.right === '') {
      el.style.left = Math.max(pad, vw - r2.width - pad) + 'px'
    }
    if (r2.left < pad) {
      if (el.style.right !== '') {
        el.style.right = ''
      }
      el.style.left = pad + 'px'
    }
  }
}

export default function MBGPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)

  // Folder tree: which projects are expanded
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  // 'tree' dulu ada di union ini tapi tidak pernah di-set maupun dirender
  // (tidak ada tombolnya, dan cabang render hanya monitor vs dashboard).
  // Dihapus bersama renderFolder yang mati agar tidak menyesatkan.
  const [viewMode, setViewMode] = useState<'dashboard' | 'monitor'>('dashboard')
  const [dashFilterProject, setDashFilterProject] = useState<string | null>(null)
  const [dashFilterQuery, setDashFilterQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'siap' | 'cooldown' | 'selesai'>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [dialogType, setDialogType] = useState<'add' | 'edit' | 'detail' | 'settings' | 'telegram' | 'edit-project' | 'add-project' | 'help' | 'share' | 'import-share' | 'notes' | 'admin' | 'templates' | 'reminders' | null>(null)
  const [confirmData, setConfirmData] = useState<{ title: string; message: string; onConfirm: () => void; confirmLabel?: string; cancelLabel?: string } | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: Task } | null>(null)
  const [projectContextMenu, setProjectContextMenu] = useState<{ x: number; y: number; project: Project } | null>(null)
  const [toasts, setToasts] = useState<{ msg: string; type: 'success' | 'error' | 'info'; id: number; actionLabel?: string; onAction?: () => void }[]>([])
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set())

  // Admin Panel State
  const [adminUsers, setAdminUsers] = useState<Array<{
    id: string; username: string; displayName: string | null; role: string; isBlocked: boolean;
    createdAt: string; inviteCode: string | null;
    _count: { projects: number; tasks: number; notes: number }
  }>>([])
  const [adminInviteCodes, setAdminInviteCodes] = useState<Array<{
    id: string; code: string; role: string; usedBy: string | null; usedAt: string | null; createdAt: string;
    user: { id: string; username: string; displayName: string | null } | null
  }>>([])
  const [adminLoading, setAdminLoading] = useState(false)

  // Telegram
  const [telegramCode, setTelegramCode] = useState('')
  const [telegramLinked, setTelegramLinked] = useState(false)
  // Ajakan menyalakan pengingat. Dulu tidak ada jalan dari layar utama ke
  // notifikasi, padahal itu alasan utama orang memakai aplikasi ini.
  // Dibaca sekali dari localStorage (pola yang sama dengan authUser di atas)
  // supaya tidak menambah effect yang memanggil setState saat render.
  const [reminderNudgeHidden, setReminderNudgeHidden] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      const raw = localStorage.getItem('mbg_auth')
      const uid = raw ? JSON.parse(raw)?.id : null
      return uid ? localStorage.getItem(`mbg_reminder_nudge_${uid}`) === 'dismissed' : true
    } catch { return true }
  })
  const [telegramName, setTelegramName] = useState('')
  const [codeGenerating, setCodeGenerating] = useState(false)
  const [telegramTesting, setTelegramTesting] = useState(false)
  const [telegramBotUsername, setTelegramBotUsername] = useState('')

  // Share Project
  const [shareCode, setShareCode] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [shareProjectName, setShareProjectName] = useState('')
  const [shareTaskCount, setShareTaskCount] = useState(0)

  // Import Share
  const [importCode, setImportCode] = useState('')
  const [importPreview, setImportPreview] = useState<{ project: { name: string; color: string }; taskCount: number } | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importChecking, setImportChecking] = useState(false)

  // Catatan (Notes)
  const [notes, setNotes] = useState<Note[]>([])
  const [notesPanelOpen, setNotesPanelOpen] = useState(false)
  const [noteFormContent, setNoteFormContent] = useState('')
  const [noteFormColor, setNoteFormColor] = useState('#FFFFCC')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)

  // Kerjakan (Work on Task)
  const [workingTaskId, setWorkingTaskId] = useState<string | null>(null)
  /* Pemakaian harian: setelah membuka link tugas, pengguna kembali ke app dan
     harus mencari tugas itu lagi untuk menandainya selesai. Id ini dipakai untuk
     menawarkan konfirmasi tepat di tempat, tanpa mencari. */
  const [returnTaskId, setReturnTaskId] = useState<string | null>(null)
  const [returnPromptOpen, setReturnPromptOpen] = useState(false)
  // Diisi oleh openTaskLink saat pengguna menekan "Buka link"; dibaca handler
  // visibilitychange. Sengaja tidak disinkronkan saat render agar tidak
  // menulis ref di badan render.
  const returnTaskRef = useRef<string | null>(null)
  const [workingCountdown, setWorkingCountdown] = useState(10)
  const [workingCompleted, setWorkingCompleted] = useState(false)
  const [undoCountdown, setUndoCountdown] = useState(0) // countdown untuk tombol undo (detik tersisa)
  const workingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const workingCompletionRef = useRef<string | null>(null)
  const workingActiveRef = useRef(false) // Guard: prevents undo UI from appearing after cancel

  // Templates (Feature 3)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null)
  const [formTemplateName, setFormTemplateName] = useState('')
  const [formTemplateDesc, setFormTemplateDesc] = useState('')
  const [formTemplateLink, setFormTemplateLink] = useState('')
  const [formTemplateScheduleType, setFormTemplateScheduleType] = useState('sekali')
  const [formTemplateScheduleConfig, setFormTemplateScheduleConfig] = useState<Record<string, unknown>>({})
  const [formTemplatePriority, setFormTemplatePriority] = useState('medium')

  // Forms
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formLink, setFormLink] = useState('')
  const [formScheduleType, setFormScheduleType] = useState('sekali')
  const [formScheduleConfig, setFormScheduleConfig] = useState<Record<string, unknown>>({})
  const [formProjectName, setFormProjectName] = useState('')
  const [formProjectColor, setFormProjectColor] = useState('#000080')
  const [formTimezone, setFormTimezone] = useState('WIB')
  const [formTimeFormat, setFormTimeFormat] = useState<'24' | '12'>('24')
  const [formAutoExpandSiap, setFormAutoExpandSiap] = useState(true)
  const [formAutoCompleteLink, setFormAutoCompleteLink] = useState(false)
  const [formTelegramNotif, setFormTelegramNotif] = useState(true)
  const [formBrowserNotif, setFormBrowserNotif] = useState(true)
  const [formNotifyBeforeMin, setFormNotifyBeforeMin] = useState(5)
  const [formAudioAlertEnabled, setFormAudioAlertEnabled] = useState(true)
  const [formProjectId, setFormProjectId] = useState<string | null>(null)
  const [formPriority, setFormPriority] = useState('medium')

  // Fix #7: Batch completing
  const [batchCompleting, setBatchCompleting] = useState<string | null>(null)
  // Aksi massal: centang beberapa task lalu selesaikan/reset sekaligus.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [savingTask, setSavingTask] = useState(false)
  const [taskFormError, setTaskFormError] = useState('')
  // Opsi A: satu tugas = satu konfirmasi server. Ref mengunci klik ganda bahkan
  // sebelum React sempat merender ulang tombol disabled.
  const savingTaskRef = useRef(false)
  const taskRequestRef = useRef<SaveAttempt | null>(null)
  const taskDefaultsRef = useRef(new Map<string, TaskFormDefaults>())
  const taskDraftBaselineRef = useRef('')
  const taskDialogRef = useRef<HTMLDivElement>(null)
  const confirmDialogRef = useRef<HTMLDivElement>(null)
  const [savedTaskCount, setSavedTaskCount] = useState(0)
  const [taskDefaultsRemembered, setTaskDefaultsRemembered] = useState(false)
  const [savingProject, setSavingProject] = useState(false)
  // Global loading bar: shows thin progress at top of window ONLY for slow operations (>150ms)
  // This prevents visual noise on fast operations while still giving feedback on slow ones
  const [globalLoading, setGlobalLoading] = useState(false)
  const globalLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const globalLoadingCountRef = useRef(0)
  const showGlobalLoading = useCallback(() => {
    globalLoadingCountRef.current++
    // Only show after 150ms delay — fast operations skip the loading bar entirely
    if (!globalLoadingTimerRef.current) {
      globalLoadingTimerRef.current = setTimeout(() => {
        if (globalLoadingCountRef.current > 0) setGlobalLoading(true)
        globalLoadingTimerRef.current = null
      }, 150)
    }
  }, [])
  const hideGlobalLoading = useCallback(() => {
    globalLoadingCountRef.current = Math.max(0, globalLoadingCountRef.current - 1)
    if (globalLoadingCountRef.current === 0) {
      if (globalLoadingTimerRef.current) {
        clearTimeout(globalLoadingTimerRef.current)
        globalLoadingTimerRef.current = null
      }
      setGlobalLoading(false)
    }
  }, [])

  // Fix #9: Move dialog
  const [moveDialogTask, setMoveDialogTask] = useState<Task | null>(null)
  const [moveTargetProjectId, setMoveTargetProjectId] = useState<string | null>(null)

  // Fix B1: Project sort state
  const [projectSort, setProjectSort] = useState<'default' | 'az'>('default')

  // Auth — localStorage sebagai source of truth, cookie untuk API calls
  const [authenticated, setAuthenticated] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return !!localStorage.getItem('mbg_auth') } catch { return false }
  })
  const [authUser, setAuthUser] = useState<{ id: string; username: string; displayName: string | null; role?: string } | null>(() => {
    if (typeof window === 'undefined') return null
    try { const s = localStorage.getItem('mbg_auth'); return s ? JSON.parse(s) : null } catch { return null }
  })

  // Helper: simpan auth ke localStorage
  const persistAuth = (user: { id: string; username: string; displayName: string | null; role?: string } | null) => {
    if (user) {
      localStorage.setItem('mbg_auth', JSON.stringify(user))
    } else {
      localStorage.removeItem('mbg_auth')
    }
    // Ajakan pengingat disimpan per akun: perangkat bersama tidak saling
    // menimpa pilihan "nanti saja".
    try {
      setReminderNudgeHidden(user ? localStorage.getItem(`mbg_reminder_nudge_${user.id}`) === 'dismissed' : true)
    } catch { setReminderNudgeHidden(true) }
  }
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [registerUsername, setRegisterUsername] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerDisplayName, setRegisterDisplayName] = useState('')
  const [registerInviteCode, setRegisterInviteCode] = useState('')
  // True kalau database belum punya user sama sekali → pendaftar pertama jadi admin
  const [bootstrapMode, setBootstrapMode] = useState(false)

  useEffect(() => {
    if (authenticated) return
    let alive = true
    fetch('/api/auth/register', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (alive) setBootstrapMode(!!d.bootstrap) })
      .catch(() => { /* diamkan: form tetap bisa dipakai */ })
    return () => { alive = false }
  }, [authenticated])
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  // Browser & Push notifications
  const prevTasksRef = useRef<Map<string, { status: string; cooldownMs: number }>>(new Map())
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'denied')
  const [pushSupported, setPushSupported] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  // null = belum tahu (jaringan gagal / belum diperiksa). false = server memang
  // belum punya VAPID key. Dipakai supaya dialog Pengingat tidak meminta izin
  // browser untuk sesuatu yang belum mungkin berhasil.
  const [pushServerConfigured, setPushServerConfigured] = useState<boolean | null>(null)
  // Service worker gagal aktif ≠ browser tidak mendukung. Sebelumnya keduanya
  // dilaporkan sebagai "browser belum mendukung", yang menyesatkan di Chrome.
  const [pushSetupFailed, setPushSetupFailed] = useState(false)

  // Register Service Worker + Push subscription
  const registerPushSubscription = useCallback(async (userId: string) => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushSupported(false)
        return
      }
      setPushSupported(true)

      // Register SW
      const registration = await navigator.serviceWorker.register('/sw.js')
      // `serviceWorker.ready` menunggu worker aktif. Kalau install gagal,
      // promise ini tidak pernah selesai dan seluruh alur push menggantung
      // tanpa pesan. Beri batas waktu supaya kegagalannya terlihat.
      const active = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 10000)),
      ])
      if (!active) {
        console.warn('Push: service worker belum aktif setelah 10 detik; notifikasi web dilewati.')
        setPushSetupFailed(true)
        return
      }

      // Check existing subscription
      const existingSub = await registration.pushManager.getSubscription()

      if (existingSub) {
        setPushEnabled(true)
        // Sync subscription to server
        const subData = existingSub.toJSON()
        if (subData.keys) {
          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ endpoint: existingSub.endpoint, keys: subData.keys })
          })
        }
        return
      }

      // Get VAPID public key
      const vapidRes = await fetch('/api/push/vapid-key', { credentials: 'include' })
      if (!vapidRes.ok) { setPushServerConfigured(false); return }
      const { publicKey } = await vapidRes.json()
      setPushServerConfigured(Boolean(publicKey))
      if (!publicKey) return

      // Request notification permission first
      const perm = await Notification.requestPermission()
      setNotifPermission(perm)
      if (perm !== 'granted') return

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      })

      // Save to server
      const subData = subscription.toJSON()
      if (subData.keys) {
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ endpoint: subscription.endpoint, keys: subData.keys })
        })
      }
      setPushEnabled(true)
    } catch (err) {
      console.error('Push registration failed:', err)
      setPushSetupFailed(true)
    }
  }, [])

  // Unsubscribe from push
  const unregisterPushSubscription = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await subscription.unsubscribe()
        const subData = subscription.toJSON()
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ endpoint: subscription.endpoint })
        })
      }
      setPushEnabled(false)
    } catch {
      // ignore
    }
  }, [])

  // Base64 URL to Uint8Array (for VAPID key)
  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  // Stable callback — not recreated every render
  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    const perm = await Notification.requestPermission()
    setNotifPermission(perm)
    // After granting permission, try to register push
    if (perm === 'granted' && authUser?.id) {
      registerPushSubscription(authUser.id)
    }
  }, [authUser?.id, registerPushSubscription])

  const sendBrowserNotif = useCallback((title: string, body: string) => {
    if (typeof Notification === 'undefined' || notifPermission !== 'granted') return
    try {
      new Notification(title, { body, icon: '/logo.svg', badge: '/logo.svg' })
    } catch { /* fallback: do nothing */ }
  }, [notifPermission])

  // Clock — use ref + direct DOM manipulation to avoid React re-renders every second
  const clockRef = useRef<HTMLElement | null>(null)

  // Debounce search — avoid re-filtering on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 200)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Flag to prevent detail opening right after context menu
  const ctxOpenTimeRef = useRef(0)

  const detailRef = useRef<Task | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputProjectImportRef = useRef<HTMLInputElement>(null)
  const projectImportTargetRef = useRef<string | null>(null)

  // Refs for viewport clamping of floating menus
  const taskCtxRef = useRef<HTMLDivElement>(null)
  const projCtxRef = useRef<HTMLDivElement>(null)
  const profileDropRef = useRef<HTMLDivElement>(null)

  // Long-press support for mobile context menu
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressPosRef = useRef({ x: 0, y: 0 })
  const longPressMovedRef = useRef(false)
  const longPressTaskRef = useRef<Task | null>(null)
  const longPressProjectRef = useRef<Project | null>(null)

  /* ===== Local Cache — instant load from localStorage ===== */
  const CACHE_VERSION = 3
  const cacheLoadRef = useRef(false) // Track if we loaded from cache this session

  // Refs to track latest state for cache writes (avoids stale closures)
  const tasksCacheRef = useRef<Task[] | null>(null) // null = not yet loaded
  const projectsCacheRef = useRef<Project[] | null>(null)
  const notesCacheRef = useRef<Note[] | null>(null)
  const templatesCacheRef = useRef<TaskTemplate[] | null>(null)
  const settingsCacheRef = useRef<Settings | null>(null)

  // Dynamic cache key based on user ID — prevents cross-user data leak
  const getCacheKey = useCallback(() => {
    const uid = authUser?.id || 'anon'
    return `mbg_cache_${uid}`
  }, [authUser?.id])

  /* ===== Settings: extract DRY settings→form sync helper (must be before loadFromCache) ===== */
  const applySettingsToForm = useCallback((sd: Record<string, unknown>) => {
    setFormTimezone(String(sd.timezone || 'WIB'))
    setFormTimeFormat(sd.timeFormat === '12' ? '12' : '24')
    setFormAutoExpandSiap(sd.autoExpandSiap !== false)
    setFormAutoCompleteLink(sd.autoCompleteLink === true)
    setFormTelegramNotif(sd.telegramNotifEnabled !== false)
    setFormBrowserNotif(sd.browserNotifEnabled !== false)
    setFormNotifyBeforeMin(Number(sd.notifyBeforeCooldownMin) || 5)
    setFormAudioAlertEnabled(sd.audioAlertEnabled !== false)
    setTelegramLinked(!!sd.telegramChatId || !!sd.telegramId)
    setTelegramName(String(sd.telegramName || ''))
    setTelegramBotUsername(String(sd.telegramBotUsername || ''))
  }, [])

  // Load data from localStorage cache (instant, 0ms)
  const loadFromCache = useCallback(() => {
    if (typeof window === 'undefined') return false
    // Don't load cache for anonymous users
    if (!authUser?.id) return false
    try {
      const raw = localStorage.getItem(getCacheKey())
      if (!raw) return false
      const cache = JSON.parse(raw)
      if (cache.v !== CACHE_VERSION || !cache.ts) return false
      // Cache older than 24h is considered stale — skip
      if (Date.now() - cache.ts > 86400000) return false
      if (cache.tasks) {
        // Status ikut dihitung ulang, bukan hanya cooldownMs: cache berumur
        // beberapa jam bisa masih menulis "Menunggu 5j 0m" untuk tugas yang sudah
        // siap, dan tombol kartu jadi "Lihat detail" bukan "Buka link".
        const mapped = refreshCachedTasks(cache.tasks as Task[])
        tasksCacheRef.current = mapped
        setTasks(mapped)
      }
      if (cache.projects) {
        projectsCacheRef.current = cache.projects as Project[]
        setProjects(projectsCacheRef.current)
      }
      if (cache.notes) {
        notesCacheRef.current = cache.notes as Note[]
        setNotes(notesCacheRef.current)
      }
      if (cache.templates) {
        templatesCacheRef.current = cache.templates as TaskTemplate[]
        setTemplates(templatesCacheRef.current)
      }
      if (cache.settings) {
        settingsCacheRef.current = cache.settings as Settings
        setSettings(settingsCacheRef.current)
        applySettingsToForm(cache.settings as Record<string, unknown>)
      }
      return true
    } catch { return false }
  }, [authUser?.id, getCacheKey, applySettingsToForm])

  // Save current state to localStorage cache (debounced via rAF)
  const saveToCacheRaf = useRef(0)
  const saveToCache = useCallback(() => {
    if (typeof window === 'undefined') return false
    if (!authUser?.id) return false // Don't cache for anonymous
    if (!tasksCacheRef.current) return false // Don't cache empty/uninitialized state
    try {
      cancelAnimationFrame(saveToCacheRaf.current)
      saveToCacheRaf.current = requestAnimationFrame(() => {
        localStorage.setItem(getCacheKey(), JSON.stringify({
          v: CACHE_VERSION,
          ts: Date.now(),
          tasks: tasksCacheRef.current,
          projects: projectsCacheRef.current || [],
          notes: notesCacheRef.current || [],
          templates: templatesCacheRef.current || [],
          settings: settingsCacheRef.current || {}
        }))
      })
      return true
    } catch { return false }
  }, [authUser?.id, getCacheKey])

  // Clear cache for current user
  const clearCache = useCallback(() => {
    if (typeof window === 'undefined') return
    try { localStorage.removeItem(getCacheKey()) } catch { /* ignore */ }
    // Also clear old cache key (before user-specific keys)
    try { localStorage.removeItem('mbg_cache') } catch { /* ignore */ }
    tasksCacheRef.current = null
    projectsCacheRef.current = null
    notesCacheRef.current = null
    templatesCacheRef.current = null
    settingsCacheRef.current = null
  }, [getCacheKey])

  /* ===== Request Deduplication — prevent duplicate concurrent requests ===== */
  const pendingRequests = useRef<Map<string, Promise<unknown>>>(new Map())

  const dedupedFetch = useCallback((url: string, opts?: RequestInit): Promise<Response> => {
    const key = `${opts?.method || 'GET'}:${url}`
    const pending = pendingRequests.current.get(key)
    if (pending) return pending as Promise<Response>
    const p = fetch(url, opts).finally(() => { pendingRequests.current.delete(key) })
    pendingRequests.current.set(key, p)
    return p
  }, [])

  /* ===== Data ===== */
  // Cookie-only auth
  const getAuthHeaders = () => {
    const h: Record<string, string> = {}
    // Removed x-mbg-uid header for security — cookie-only auth
    return h
  }
  const fetchOpts = (signal?: AbortSignal) => ({ credentials: 'include' as RequestCredentials, headers: getAuthHeaders(), signal })
  // Shorthand for POST/PUT/DELETE with JSON body
  const jsonOpts = (method: string, body: unknown, extra: Record<string, unknown> = {}) => ({
    method, headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(body), credentials: 'include' as RequestCredentials, ...extra
  })
  const api = (url: string, opts?: RequestInit) => {
    const { headers: customHeaders, ...rest } = opts || {}
    return fetch(url, { credentials: 'include' as RequestCredentials, headers: { ...getAuthHeaders(), ...customHeaders }, ...rest })
  }

  // Helper: ensure user is identified — sync localStorage dengan server via /api/identify
  const ensureIdentified = useCallback(async (signal?: AbortSignal) => {
    // Jika localStorage punya data, cek ke server untuk sinkronisasi
    if (authUser?.id) {
      try {
        const res = await fetch('/api/identify', fetchOpts(signal))
        if (res.ok) {
          const data = await res.json()
          if (data.authenticated && data.userId) {
            const u = { id: data.userId, username: data.username, displayName: data.displayName, role: data.role }
            setAuthUser(u)
            persistAuth(u)
            return data.userId
          }
          // res.ok but not authenticated — cookie exists but invalid, force logout
          setAuthUser(null)
          setAuthenticated(false)
          persistAuth(null)
          return null
        }
        // 401 = blocked or cookie cleared — server explicitly rejected, must logout
        if (res.status === 401) {
          try {
            const data = await res.json()
            if (data.blocked) {
              toast('Akun Anda telah diblokir oleh admin.', 'error')
            }
          } catch { /* ignore parse error */ }
          setAuthUser(null)
          setAuthenticated(false)
          persistAuth(null)
          return null
        }
      } catch { /* network error only — allow localStorage fallback */ }
      // Jaringan error saja yang boleh fallback ke localStorage
      return authUser.id
    }
    // Tidak ada data di localStorage, cek server (mungkin cookie masih ada)
    try {
      const res = await fetch('/api/identify', fetchOpts(signal))
      if (res.ok) {
        const data = await res.json()
        if (data.authenticated && data.userId) {
          const u = { id: data.userId, username: data.username, displayName: data.displayName, role: data.role }
          setAuthUser(u)
          setAuthenticated(true)
          persistAuth(u)
          return data.userId
        }
      }
    } catch { /* ignore */ }
    return null
  }, [authUser?.id])

  const fetchData = useCallback(async (isManualRefresh?: boolean, skipAuthCheck?: boolean) => {
    if (isManualRefresh) {
      setExpandedProjects(new Set())
      initialExpandDone.current = false
    }
    try {
      // STEP 0: Load from cache FIRST (instant — 0ms)
      if (!cacheLoadRef.current && !isManualRefresh) {
        const loaded = loadFromCache()
        cacheLoadRef.current = true // Mark as attempted (even if no cache found)
        if (loaded) {
          setLoading(false) // Show cached data immediately!
        }
      }

      const controller = new AbortController()
      const signal = controller.signal
      const timeout = setTimeout(() => controller.abort(), 20000)

      // STEP 1: Check auth HANYA saat pertama kali / manual refresh
      // Kalau skipAuthCheck=true (sesudah login/register/periodic), langsung fetch data
      if (!skipAuthCheck) {
        const userId = await ensureIdentified(signal)
        if (!userId) return // Not logged in, will show login screen
      }

      // STEP 2: Fetch all data in ONE request (avoids multiple Vercel cold starts)
      const res = await dedupedFetch('/api/init', fetchOpts(signal)).catch(() => null)
      clearTimeout(timeout)

      if (!res) {
        // Server unreachable but we have cache — stay with cache
        if (cacheLoadRef.current) return
        return
      }

      // 401 = blocked/expired — handle auth rejection
      if (res.status === 401) {
        if (!skipAuthCheck) {
          setAuthUser(null)
          setAuthenticated(false)
          persistAuth(null)
        }
        return
      }

      const data = await res.json().catch(() => null)
      if (!data) return

      // Process user identity from /api/init response
      if (data.user && data.user.authenticated) {
        const u = { id: data.user.userId, username: data.user.username, displayName: data.user.displayName, role: data.user.role }
        setAuthUser(u)
        setAuthenticated(true)
        persistAuth(u)
      }

      // Only update tasks/projects if enough time passed since last write (avoid overwriting optimistic state)
      const timeSinceWrite = Date.now() - lastWriteTime.current
      const shouldUpdateData = timeSinceWrite > SKIP_FETCH_AFTER_WRITE_MS || timeSinceWrite < 0

      if (shouldUpdateData) {
        const newTasks = Array.isArray(data.tasks) ? (data.tasks as Task[]).map((t: Task) => ({
          ...t,
          cooldownMs: t.nextReadyAt ? Math.max(0, new Date(t.nextReadyAt).getTime() - Date.now()) : 0
        })) : []
        const newProjects = Array.isArray(data.projects) ? data.projects as Project[] : []
        const newNotes = Array.isArray(data.notes) ? data.notes : []
        const newTemplates = Array.isArray(data.templates) ? data.templates : []
        const newSettings = data.settings && typeof data.settings === 'object' ? data.settings as Settings : {}

        // Update refs first (for cache)
        tasksCacheRef.current = newTasks
        projectsCacheRef.current = newProjects
        notesCacheRef.current = newNotes
        templatesCacheRef.current = newTemplates
        settingsCacheRef.current = newSettings

        setTasks(newTasks)
        setProjects(newProjects)
        setNotes(newNotes)
        setTemplates(newTemplates)

        const sd = (typeof data.settings === 'object' && !Array.isArray(data.settings)) ? data.settings as Record<string, unknown> : {}
        setSettings(newSettings)
        applySettingsToForm(sd)

        // Save to cache after successful fetch
        saveToCache()
      }
    } catch (e) { console.error('fetchData error:', e) }
    finally { setLoading(false) }
  }, [ensureIdentified, loadFromCache, saveToCache, dedupedFetch, applySettingsToForm])

  const fetchNotes = useCallback(async () => {
    try {
      const res = await api('/api/notes')
      if (res.ok) {
        const data = await res.json()
        setNotes(Array.isArray(data) ? data : [])
      }
    } catch { /* silent */ }
  }, [])

  /* ===== Fetch Templates (Feature 3) ===== */
  const fetchTemplates = useCallback(async () => {
    try {
      const res = await api('/api/templates')
      if (res.ok) {
        const data = await res.json()
        setTemplates(Array.isArray(data) ? data : [])
      }
    } catch { /* silent */ }
  }, [])

  // Use refs for stable callbacks to prevent dependency thrashing
  const fetchDataRef = useRef(fetchData)
  fetchDataRef.current = fetchData
  const registerPushRef = useRef(registerPushSubscription)
  registerPushRef.current = registerPushSubscription

  // Initial fetch — single /api/init call replaces 6 separate API calls
  useEffect(() => {
    fetchDataRef.current();
    if (authUser?.id) registerPushRef.current(authUser.id)
  }, [authUser?.id])

  // Periodic sync — hanya saat tab terlihat.
  // Sebelumnya interval tetap berjalan walau tab di background/minimized:
  // setiap 60 detik memuat ulang SELURUH data (project + task + log) padahal
  // tidak ada yang melihatnya. Sekarang polling dilewati saat tab tidak aktif,
  // dan langsung menyegarkan sekali ketika tab kembali terlihat.
  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      fetchDataRef.current(false, true)
    }
    const i = setInterval(tick, 60000)
    const onVisible = () => {
      if (document.hidden) return
      fetchDataRef.current(false, true)
      // Baru kembali dari mengerjakan tugas di tab/aplikasi lain.
      if (returnTaskRef.current) setReturnPromptOpen(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(i)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Periodic cache save — capture optimistic mutations between server syncs
  useEffect(() => {
    if (!authenticated) return
    const i = setInterval(() => saveToCache(), 10000) // Save cache every 10s
    return () => clearInterval(i)
  }, [authenticated, saveToCache])

  // Scheduler: panggil /api/notify/run setiap 30 detik untuk Telegram notif
  useEffect(() => {
    if (!authenticated) return
    // Catch-up notifikasi tetap dipertahankan sebagai jaring pengaman kalau cron
    // server belum jalan, tapi dilewati saat tab tidak aktif (cron server yang
    // menangani kasus itu) — hemat request dan kuota Telegram.
    const run = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        await fetch('/api/notify/run', { method: 'POST', credentials: 'include', headers: getAuthHeaders() })
      } catch {
        // Diabaikan: ini jalur opsional, cron server tetap sumber utama.
      }
    }
    run()
    const iv = setInterval(run, 60000)
    return () => clearInterval(iv)
  }, [authenticated])

  // Audio alert utility (Feature 5) — reuse AudioContext to avoid browser instance limit
  const audioCtxRef = useRef<AudioContext | null>(null)
  const playBeep = useCallback((frequency: number, duration: number, volume = 0.3) => {
    if (settings.audioAlertEnabled === false) return
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      }
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = frequency
      osc.type = 'sine'
      gain.gain.value = volume
      osc.start()
      osc.stop(ctx.currentTime + duration / 1000)
    } catch { /* Web Audio not available */ }
  }, [settings.audioAlertEnabled])

  const playAlertAlmostReady = useCallback(() => playBeep(800, 200, 0.2), [playBeep])
  const playAlertReady = useCallback(() => {
    playBeep(1000, 150, 0.3)
    setTimeout(() => playBeep(1000, 150, 0.3), 250)
  }, [playBeep])
  const playAlertPomodoro = useCallback(() => {
    playBeep(600, 300, 0.3)
    setTimeout(() => playBeep(800, 400, 0.3), 350)
  }, [playBeep])

  // Browser notif: deteksi task yang baru siap dari cooldown
  useEffect(() => {
    if (loading || !authenticated) return
    const prev = prevTasksRef.current
    const curr = new Map<string, { status: string; cooldownMs: number }>()
    let hasNewReady = false
    let newReadyNames: string[] = []
    let hasAlmostReady = false
    let almostReadyNames: string[] = []

    for (const t of tasks) {
      curr.set(t.id, { status: t.status, cooldownMs: t.cooldownMs })
      const p = prev.get(t.id)
      if (p) {
        // Task yang sebelumnya cooldown, sekarang sudah siap
        if (p.status === 'cooldown' && t.status === 'siap') {
          hasNewReady = true
          newReadyNames.push(t.name)
        }
      }
    }
    prevTasksRef.current = curr

    // Cek task yang hampir siap (based on user setting: notifyBeforeCooldownMin)
    const notifyBeforeMs = ((settings as Record<string, unknown>).notifyBeforeCooldownMin as number || 5) * 60 * 1000
    for (const t of tasks) {
      if (t.status === 'cooldown' && t.cooldownMs > 0 && t.cooldownMs <= notifyBeforeMs) {
        const p = prev.get(t.id)
        // Baru masuk zona notifikasi
        if (p && (p.cooldownMs > notifyBeforeMs || p.status === 'siap')) {
          hasAlmostReady = true
          almostReadyNames.push(t.name)
        }
      }
    }

    if (hasNewReady && (settings as Record<string, unknown>).browserNotifEnabled !== false) {
      if (newReadyNames.length === 1) {
        sendBrowserNotif('✅ Task Siap!', newReadyNames[0])
        toast('✅ Siap: ' + newReadyNames[0], 'info')
      } else if (newReadyNames.length <= 3) {
        sendBrowserNotif('✅ Task Siap!', newReadyNames.join(', '))
        toast('✅ ' + newReadyNames.length + ' task siap!', 'info')
      } else {
        sendBrowserNotif('✅ Task Siap!', newReadyNames.length + ' task baru siap dikerjakan')
        toast('✅ ' + newReadyNames.length + ' task siap!', 'info')
      }
      // Audio alert for ready
      playAlertReady()
    }

    // Notif browser: task hampir siap (based on user setting)
    if (hasAlmostReady && (settings as Record<string, unknown>).browserNotifEnabled !== false) {
      const minLabel = (settings as Record<string, unknown>).notifyBeforeCooldownMin || 5
      if (almostReadyNames.length === 1) {
        sendBrowserNotif('⏰ Hampir Siap!', almostReadyNames[0] + ` — kurang dari ${minLabel} menit`)
        toast('⏰ Hampir siap: ' + almostReadyNames[0], 'info')
      } else if (almostReadyNames.length <= 3) {
        sendBrowserNotif('⏰ Hampir Siap!', almostReadyNames.join(', '))
        toast('⏰ ' + almostReadyNames.length + ' task hampir siap!', 'info')
      } else {
        sendBrowserNotif('⏰ Hampir Siap!', almostReadyNames.length + ` task kurang dari ${minLabel} menit`)
        toast('⏰ ' + almostReadyNames.length + ' task hampir siap!', 'info')
      }
      // Audio alert for almost ready
      playAlertAlmostReady()
    }
  }, [tasks, loading, authenticated, (settings as Record<string, unknown>).browserNotifEnabled, sendBrowserNotif, playAlertReady, playAlertAlmostReady])

  // Auto-expand projects that have ready tasks (every data refresh, not just first load)
  // Respects the autoExpandSiap setting
  const initialExpandDone = useRef(false)
  useEffect(() => {
    if (loading || projects.length === 0) return
    // If autoExpandSiap is OFF, only do first-load expand
    const shouldAutoExpand = settings.autoExpandSiap !== false
    setExpandedProjects(prev => {
      const autoExpand = new Set<string>(prev)
      let hasAnySiap = false
      if (shouldAutoExpand) {
        projects.forEach(p => {
          const hasSiap = tasks.some(t => t.project?.id === p.id && t.status === 'siap')
          if (hasSiap) { autoExpand.add(p.id); hasAnySiap = true }
        })
      }
      // First load: if none have siap, expand first project
      if (!initialExpandDone.current && prev.size === 0 && projects.length > 0) {
        // If auto-expand is on but no siap, expand first; if off, always expand first
        if (!hasAnySiap || !shouldAutoExpand) {
          autoExpand.add(projects[0].id)
        }
      }
      initialExpandDone.current = true
      return autoExpand
    })
  }, [loading, projects, tasks, settings.autoExpandSiap])

  /* ===== Cooldown timer — skip re-render if nothing changed ===== */
  useEffect(() => {
    const tick = setInterval(() => {
      setTasks(prev => {
        let changed = false
        const next = prev.map(t => {
          if (t.status !== 'cooldown' || !t.nextReadyAt) return t
          const ms = Math.max(0, new Date(t.nextReadyAt).getTime() - Date.now())
          if (ms <= 0) {
            if (t.cooldownMs === 0 && t.cooldownRemaining === '') return t
            changed = true
            return { ...t, cooldownRemaining: '', cooldownMs: 0, status: 'siap' as const }
          }
          const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000)
          let text = ''
          if (h >= 1) text = `${h}j ${m}m`
          else if (m >= 1) text = `${m}m ${s}s`
          else text = `${s}s`
          if (t.cooldownRemaining === text && t.cooldownMs === ms) return t
          changed = true
          return { ...t, cooldownRemaining: text, cooldownMs: ms }
        })
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [])

  /* ===== Fix H1: Keep detailRef in sync with tasks when detail dialog is open ===== */
  useEffect(() => {
    if (dialogType === 'detail' && selectedTaskId) {
      const fresh = tasks.find(t => t.id === selectedTaskId)
      if (fresh) {
        detailRef.current = fresh
      } else {
        // Task was deleted while detail dialog is open — close the dialog
        detailRef.current = null
        setDialogType(null)
        setSelectedTaskId(null)
      }
    }
  }, [tasks, dialogType, selectedTaskId])

  /* ===== Time formatting helpers (12h/24h) with timezone support ===== */
  const userTzRef = useRef('Asia/Jakarta')
  // Keep timezone ref in sync with settings
  useEffect(() => {
    const tz = (settings as Record<string, unknown>).timezone as string || 'WIB'
    const TZ_MAP: Record<string, string> = { WIB: 'Asia/Jakarta', WITA: 'Asia/Makassar', WIT: 'Asia/Jayapura' }
    userTzRef.current = TZ_MAP[tz] || 'Asia/Jakarta'
  }, [settings])

  const timeOpts: Intl.DateTimeFormatOptions = {
    ...(formTimeFormat === '12'
      ? { hour: '2-digit', minute: '2-digit', hour12: true }
      : { hour: '2-digit', minute: '2-digit', hour12: false }),
    timeZone: userTzRef.current,
  }
  const fmtTime = (d: Date) => d.toLocaleTimeString('id-ID', { ...timeOpts, timeZone: userTzRef.current })
  const fmtDate = (d: Date) => d.toLocaleString('id-ID', { day: '2-digit', month: 'short', ...timeOpts, timeZone: userTzRef.current })
  const fmtFull = (d: Date) => d.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', ...timeOpts, timeZone: userTzRef.current })

  /* ===== Clock: direct DOM — no React re-render every second ===== */
  // BUG FIX: Read timezone & format from refs directly (not stale DOM attributes)
  const clockFmtRef = useRef('24')
  const clockTzRef = useRef('Asia/Jakarta')
  useEffect(() => {
    const tz = (settings as Record<string, unknown>).timezone as string || 'WIB'
    const TZ_MAP: Record<string, string> = { WIB: 'Asia/Jakarta', WITA: 'Asia/Makassar', WIT: 'Asia/Jayapura' }
    clockTzRef.current = TZ_MAP[tz] || 'Asia/Jakarta'
    clockFmtRef.current = (settings as Record<string, unknown>).timeFormat === '12' ? '12' : '24'
  }, [settings])
  useEffect(() => {
    const update = () => {
      const el = clockRef.current
      if (!el) return
      // Read directly from refs — always up-to-date, no stale DOM
      const fmt = clockFmtRef.current
      const tz = clockTzRef.current
      const opts: Intl.DateTimeFormatOptions = fmt === '12'
        ? { hour: '2-digit' as const, minute: '2-digit' as const, hour12: true as const, timeZone: tz }
        : { hour: '2-digit' as const, minute: '2-digit' as const, hour12: false as const, timeZone: tz }
      const timeStr = new Date().toLocaleTimeString('id-ID', opts)
      // Find or create the time text node
      let timeNode = el.querySelector('.clock-time')
      if (!timeNode) {
        timeNode = document.createElement('span')
        timeNode.className = 'clock-time'
        el.appendChild(timeNode)
      }
      timeNode.textContent = ' ' + timeStr
    }
    update()
    const i = setInterval(update, 1000)
    return () => clearInterval(i)
  }, [])

  // Robust toast ID counter — no collisions (vs Date.now()+Math.random)
  const toastIdRef = useRef(0)
  const toastTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const fetchTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // Track all misc setTimeout calls for cleanup
  const miscTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // Track last optimistic write time — prevent stale fetch from overwriting optimistic state
  const lastWriteTime = useRef(0)
  const SKIP_FETCH_AFTER_WRITE_MS = 5000 // Reduced from 8s: Don't overwrite tasks/projects within 5s of a write

  // Helper: delayed fetch with cleanup tracking + save to local cache
  const delayedFetch = useCallback(() => {
    // Skip if we're within the write protection window — data won't be applied anyway
    const timeSinceWrite = Date.now() - lastWriteTime.current
    const waitMs = timeSinceWrite < 0
      ? 1000 // lastWriteTime is in the future, wait briefly
      : Math.max(1000, SKIP_FETCH_AFTER_WRITE_MS - timeSinceWrite + 500) // wait until after protection window + 500ms buffer
    const t = setTimeout(() => fetchData(false, true), Math.min(waitMs, 10000)) // cap at 10s
    fetchTimeoutsRef.current.push(t)
  }, [fetchData])

  /* ===== Cleanup all timers on unmount ===== */
  useEffect(() => {
    return () => {
      if (workingTimerRef.current) clearInterval(workingTimerRef.current)
      if (undoTimerRef.current) clearInterval(undoTimerRef.current)
      // Notification settings: notifyBeforeCooldownMin
      if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
      if (globalLoadingTimerRef.current) { clearTimeout(globalLoadingTimerRef.current); globalLoadingTimerRef.current = null }
      if (saveToCacheRaf.current) cancelAnimationFrame(saveToCacheRaf.current)
      toastTimersRef.current.forEach(t => clearTimeout(t))
      fetchTimeoutsRef.current.forEach(t => clearTimeout(t))
      miscTimeoutsRef.current.forEach(t => clearTimeout(t))
    }
  }, [])

  // Sync React state → cache refs (only when authenticated and not loading)
  useEffect(() => { if (authenticated && !loading) tasksCacheRef.current = tasks }, [tasks, authenticated, loading])
  useEffect(() => { if (authenticated && !loading) projectsCacheRef.current = projects }, [projects, authenticated, loading])
  useEffect(() => { if (authenticated && !loading) notesCacheRef.current = notes }, [notes, authenticated, loading])
  useEffect(() => { if (authenticated && !loading) templatesCacheRef.current = templates }, [templates, authenticated, loading])
  useEffect(() => { if (authenticated && !loading) settingsCacheRef.current = settings }, [settings, authenticated, loading])

  /**
   * Toast with optional action button (e.g. "Undo").
   * Toasts that carry an action stay on screen longer so the user actually has
   * time to react — a 2.5s window is not enough to notice and click.
   */
  const toast = (
    msg: string,
    type: 'success' | 'error' | 'info' = 'info',
    opts?: { actionLabel?: string; onAction?: () => void; duration?: number }
  ) => {
    const id = ++toastIdRef.current
    setToasts(p => [...p, { msg, type, id, actionLabel: opts?.actionLabel, onAction: opts?.onAction }])
    const duration = opts?.duration ?? (opts?.actionLabel ? 8000 : type === 'error' ? 5000 : 3000)
    const timer = setTimeout(() => {
      setToasts(p => p.filter(t => t.id !== id))
      const idx = toastTimersRef.current.indexOf(timer)
      if (idx > -1) toastTimersRef.current.splice(idx, 1)
    }, duration)
    toastTimersRef.current.push(timer)
  }

  const dismissToast = (id: number) => setToasts(p => p.filter(t => t.id !== id))

  /* ===== Auto-close notes panel when dialog opens (z-index conflict fix) ===== */
  useEffect(() => {
    if (dialogType) setNotesPanelOpen(false)
  }, [dialogType])

  /* ===== Task CRUD ===== */
  // Ref-based guard for double-completion (avoids stale closure issue with completingIds state)
  const completingIdsRef = useRef<Set<string>>(new Set())
  const complete = async (id: string) => {
    if (completingIdsRef.current.has(id)) return
    completingIdsRef.current.add(id)
    setCompletingIds(p => new Set(p).add(id))
    const previousTask = tasks.find(t => t.id === id)
    const taskName = previousTask?.name || ''
    // BUG FIX: TRUE optimistic update — change status BEFORE API call for instant feedback
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'selesai' as const, cooldownRemaining: '', cooldownMs: 0 } : t))
    lastWriteTime.current = Date.now()
    try {
      const res = await api(`/api/tasks/${id}/complete`, { method: 'POST' })
      if (!res.ok) {
        // Pulihkan tampilan segera; sinkronisasi tetap dilakukan sesudahnya.
        if (previousTask) setTasks(prev => prev.map(t => t.id === id ? previousTask : t))
        lastWriteTime.current = 0
        toast('Gagal menyelesaikan task', 'error')
        delayedFetch()
        return
      }
      // BUG FIX: Use enriched task data from response to avoid status flicker (selesai→cooldown jump)
      const data = await res.json().catch(() => ({}))
      if (data.task) {
        setTasks(prev => prev.map(t => t.id === id ? {
          ...t,
          status: data.task.status || 'cooldown',
          nextReadyAt: data.task.nextReadyAt || null,
          lastCompletedAt: data.task.lastCompletedAt || null,
          cooldownRemaining: data.task.cooldownRemaining || '',
          cooldownMs: data.task.cooldownMs || 0,
          logCount: data.task.logCount ?? ((t as unknown as Record<string, unknown>).logCount as number || 0) + 1,
        } : t))
      }
      const logId = typeof data.logId === 'string' ? data.logId : null
      toast('Selesai: ' + (taskName || 'task'), 'success', logId ? {
        actionLabel: 'Undo',
        onAction: () => undoComplete(id, logId),
      } : undefined)
      delayedFetch()
      return logId
    }
    catch { if (previousTask) setTasks(prev => prev.map(t => t.id === id ? previousTask : t)); lastWriteTime.current = 0; toast('Gagal menyelesaikan task', 'error'); delayedFetch() }
    finally { completingIdsRef.current.delete(id); setCompletingIds(p => { const n = new Set(p); n.delete(id); return n }) }
  }

  /**
   * Batalkan satu penyelesaian.
   *
   * Dengan `logId` (toast Undo) yang dibatalkan tepat log dari aksi tersebut.
   * Tanpa `logId` server memakai log terbaru — dipakai tombol "Batalkan selesai"
   * pada tugas yang sudah selesai, karena tugas "Sekali" tidak punya Reset dan
   * toast Undo-nya sudah lama hilang.
   */
  const undoComplete = async (id: string, logId?: string | null) => {
    const previous = tasks.find(t => t.id === id)
    // Umpan balik langsung: tugas kembali aktif tanpa menunggu refetch.
    setTasks(prev => prev.map(t => t.id === id
      ? { ...t, status: 'siap' as const, nextReadyAt: null, cooldownRemaining: '', cooldownMs: 0 }
      : t))
    const restore = () => { if (previous) setTasks(prev => prev.map(t => t.id === id ? previous : t)) }
    try {
      const res = await api(`/api/tasks/${id}/undo`, logId ? jsonOpts('POST', { logId }) : { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        restore()
        toast(data.error || 'Tidak ada penyelesaian untuk dibatalkan', 'error')
        return
      }
      lastWriteTime.current = 0
      toast('Penyelesaian dibatalkan', 'info')
      delayedFetch()
    } catch {
      restore()
      toast('Gagal membatalkan (jaringan)', 'error')
    }
  }

  /** Undo hanya task yang benar-benar berhasil diselesaikan. */
  const undoManyComplete = async (tokens: CompletionToken[]) => {
    const results = await Promise.allSettled(tokens.map(({ id, logId }) => api(`/api/tasks/${id}/undo`, jsonOpts('POST', { logId }))))
    const ok = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
    lastWriteTime.current = 0
    toast(ok === tokens.length ? `${ok} penyelesaian dibatalkan` : `${ok} dibatalkan, ${tokens.length - ok} gagal`, ok === tokens.length ? 'info' : 'error')
    delayedFetch()
  }

  /* ===== Aksi massal ===== */
  const bulkBusyRef = useRef(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const toggleBulk = (id: string) => setBulkSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const clearBulk = () => setBulkSelected(new Set())
  const exitSelectMode = () => { clearBulk(); setSelectMode(false) }

  const runBulk = async (ids: string[], operation: 'complete' | 'reset') => {
    if (bulkBusyRef.current) return
    bulkBusyRef.current = true
    setBulkBusy(true)
    setConfirmData(null)
    try {
      const results = await Promise.allSettled(ids.map(id => api(`/api/tasks/${id}/${operation}`, { method: 'POST' })))
      const succeeded = ids.filter((_, i) => {
        const result = results[i]
        return result.status === 'fulfilled' && result.value.ok
      })
      const tokens = operation === 'complete' ? (await Promise.all(results.map(async (r, i) => {
        if (r.status !== 'fulfilled' || !r.value.ok) return null
        const body = await r.value.json().catch(() => ({}))
        return typeof body.logId === 'string' ? { id: ids[i], logId: body.logId } : null
      }))).filter((t): t is CompletionToken => t !== null) : []
      const successfulIds = new Set(succeeded)
      const failed = ids.length - succeeded.length
      if (!failed && bulkSelected.size === ids.length) setSelectMode(false)
      setBulkSelected(prev => new Set([...prev].filter(id => !successfulIds.has(id))))
      const label = operation === 'complete' ? 'diselesaikan' : 'di-reset'
      toast(failed ? `${succeeded.length} ${label}, ${failed} gagal` : `${succeeded.length} task ${label}`,
        failed ? 'error' : 'success',
        tokens.length > 0
          ? { actionLabel: tokens.length === succeeded.length ? 'Undo semua' : 'Undo yang tersedia', onAction: () => undoManyComplete(tokens) }
          : undefined)
    } finally {
      bulkBusyRef.current = false
      setBulkBusy(false)
      lastWriteTime.current = 0
      delayedFetch()
    }
  }

  const bulkComplete = () => {
    const selected = tasks.filter(t => bulkSelected.has(t.id))
    const ids = selected.filter(t => t.status === 'siap').map(t => t.id)
    if (!ids.length) { toast('Tidak ada task siap di pilihan', 'info'); return }
    const skipped = selected.length - ids.length
    setConfirmData({ title: 'Selesaikan task pilihan',
      message: `Selesaikan ${ids.length} task siap?${skipped ? ` ${skipped} task lain dilewati karena tidak siap.` : ''}`,
      onConfirm: () => { void runBulk(ids, 'complete') } })
  }

  const bulkReset = () => {
    const selected = tasks.filter(t => bulkSelected.has(t.id))
    const ids = selected.filter(t => t.status !== 'siap' && t.scheduleType !== 'sekali' && t.scheduleType !== 'tanggal_spesifik').map(t => t.id)
    if (!ids.length) { toast('Tidak ada task pilihan yang bisa di-reset', 'info'); return }
    const skipped = selected.length - ids.length
    setConfirmData({ title: 'Reset task pilihan',
      message: `Reset ${ids.length} task? SELURUH riwayat penyelesaiannya akan dihapus dan tidak dapat dibatalkan.${skipped ? ` ${skipped} task lain dilewati karena tidak dapat di-reset.` : ''}`,
      onConfirm: () => { void runBulk(ids, 'reset') } })
  }

  const resetTask = async (id: string) => {
    // BUG FIX: TRUE optimistic update — change status BEFORE API call for instant feedback
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'siap' as const, nextReadyAt: null, cooldownRemaining: '', cooldownMs: 0 } : t))
    lastWriteTime.current = Date.now()
    try {
      const res = await api(`/api/tasks/${id}/reset`, { method: 'POST' })
      if (!res.ok) {
        lastWriteTime.current = 0
        toast('Gagal mereset task', 'error')
        delayedFetch()
        return
      }
      toast('Task di-reset!', 'success')
      delayedFetch()
    }
    catch { lastWriteTime.current = 0; toast('Gagal mereset task', 'error'); delayedFetch() }
  }

  /** Dipakai kartu, menu ⋯, dan dialog detail untuk tugas berstatus selesai. */
  const undoLastComplete = (t: Task) => undoComplete(t.id, null)

  const reset = (id: string) => {
    setConfirmData({
      title: 'Hapus riwayat dan reset', message: 'Yakin reset task ini? Seluruh riwayat penyelesaiannya akan dihapus dan tidak dapat dibatalkan.',
      onConfirm: async () => { setConfirmData(null); await resetTask(id) }
    })
  }

  const delTask = (id: string) => {
    setConfirmData({
      title: 'Hapus Task', message: 'Yakin hapus task ini? Log juga ikut terhapus.',
      onConfirm: async () => {
        setConfirmLoading(true)
        // Optimistic delete — prevent sync from re-adding it
        setTasks(prev => prev.filter(t => t.id !== id))
        lastWriteTime.current = Date.now()
        let success = false
        try {
          // Try delete, with 1 retry on failure
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const res = await api(`/api/tasks/${id}`, { method: 'DELETE' })
              if (res.ok) { success = true; break }
              // 404 = already deleted (maybe from another tab), treat as success
              if (res.status === 404) { success = true; break }
              // 401 = auth expired, don't retry
              if (res.status === 401) { toast('Sesi expired, silakan login ulang', 'error'); lastWriteTime.current = 0; delayedFetch(); break }
              // Other error — retry once
              if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue }
              toast('Gagal menghapus task (server error)', 'error'); lastWriteTime.current = 0; delayedFetch()
            } catch (networkErr) {
              // Network error — retry once
              if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue }
              toast('Gagal menghapus task (jaringan)', 'error'); lastWriteTime.current = 0; delayedFetch()
            }
          }
        } finally {
          setConfirmLoading(false)
          setConfirmData(null)
          if (success) {
            toast('Dihapus!', 'success')
            delayedFetch()
          }
        }
      }
    })
  }

  const currentTaskForm = (): TaskFormSnapshot => ({
    name: formName, description: formDesc, link: formLink,
    scheduleType: formScheduleType, scheduleConfig: formScheduleConfig,
    projectId: projectIdForNewTask(formProjectId), priority: formPriority,
  })

  const resetTaskDialog = () => {
    setDialogType(null); setSelectedTaskId(null); setTaskFormError('')
    setFormName(''); setFormDesc(''); setFormLink('')
    taskRequestRef.current = null; taskDraftBaselineRef.current = ''
    setSavedTaskCount(0); setTaskDefaultsRemembered(false)
  }

  const requestCloseTaskDialog = () => {
    if (savingTaskRef.current) return
    if (!isTaskFormDirty(currentTaskForm(), taskDraftBaselineRef.current)) { resetTaskDialog(); return }
    setConfirmData({
      title: 'Buang draft tugas?',
      message: 'Isian yang belum disimpan akan hilang. Tugas yang sudah tersimpan tetap aman.',
      confirmLabel: 'Buang draft', cancelLabel: 'Lanjut menulis',
      onConfirm: () => { setConfirmData(null); resetTaskDialog() },
    })
  }

  const saveTask = async (mode: 'close' | 'again' = 'close') => {
    // Ref, bukan hanya state: dua klik sangat cepat tidak boleh mengirim dua POST.
    if (savingTaskRef.current) return
    if (!formName.trim()) { setTaskFormError('Nama tugas wajib diisi.'); return }
    const scheduleError = scheduleInputError(formScheduleType, formScheduleConfig)
    if (scheduleError) { setTaskFormError(scheduleError); return }
    if (formLink.trim()) {
      try { const u = new URL(formLink.trim()); if (!['http:', 'https:'].includes(u.protocol)) throw new Error('protocol') }
      catch { setTaskFormError('Link harus dimulai dengan http:// atau https://.'); return }
    }
    const isAdd = dialogType === 'add'
    if (!isAdd && !(dialogType === 'edit' && selectedTaskId)) return
    const editId = selectedTaskId
    // Bekukan isi saat tombol ditekan; perubahan selama request tidak boleh
    // membuat pesan sukses merujuk isi yang berbeda.
    const form = currentTaskForm()
    const payload = {
      name: form.name.trim(), description: form.description.trim() || null, link: form.link.trim() || null,
      scheduleType: form.scheduleType, scheduleConfig: JSON.parse(canonicalJson(form.scheduleConfig)) as Record<string, unknown>,
      projectId: form.projectId, priority: form.priority,
    }
    // Isi sama → kunci sama (retry tidak menggandakan). Isi berubah setelah
    // percobaan gagal → percobaan baru, supaya tidak terkunci di penolakan 409.
    if (isAdd) taskRequestRef.current = nextSaveAttempt(taskRequestRef.current, canonicalJson(payload))
    setTaskFormError('')
    savingTaskRef.current = true
    setSavingTask(true)
    try {
      const res = await api(isAdd ? '/api/tasks' : `/api/tasks/${editId}`, jsonOpts(isAdd ? 'POST' : 'PUT', {
        ...payload, ...(isAdd ? { clientRequestId: taskRequestRef.current?.key } : {}),
      }))
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (attemptIsSettled(err.code)) {
          // Percobaan sebelumnya ternyata sudah tersimpan. Lepas kuncinya supaya
          // tombol Simpan tidak menolak terus dengan pesan yang sama.
          taskRequestRef.current = null
          setTaskFormError('Tugas dari percobaan sebelumnya sudah tersimpan (koneksi mungkin terputus). Daftar sedang diperbarui — periksa dulu. Tekan Simpan lagi hanya kalau ini memang tugas yang berbeda.')
          lastWriteTime.current = 0
          void fetchData(false, true)
          return
        }
        setTaskFormError(err.error || 'Tugas tidak tersimpan. Periksa data dan coba lagi.')
        return
      }
      // Server sudah konfirmasi. Kunci percobaan selesai; tugas berikutnya wajib
      // memakai kunci baru agar tidak dianggap retry dari tugas ini.
      taskRequestRef.current = null
      if (isAdd) {
        const defaults: TaskFormDefaults = { scheduleType: payload.scheduleType, scheduleConfig: payload.scheduleConfig, priority: payload.priority }
        rememberTaskDefaults(taskDefaultsRef.current, authUser?.id, payload.projectId, defaults)
        setViewMode('dashboard'); setActiveTab('all')
        setDashFilterProject(projectFilterAfterAdd(dashFilterProject, payload.projectId))
        setDashFilterQuery(''); setSearchQuery(''); setBulkSelected(new Set()); setSelectMode(false)
        if (mode === 'again') {
          const next = emptyTaskForm(payload.projectId, defaults)
          setFormName(next.name); setFormDesc(next.description); setFormLink(next.link)
          setFormScheduleType(next.scheduleType); setFormScheduleConfig(cloneTaskDefaults(defaults).scheduleConfig)
          setFormProjectId(next.projectId); setFormPriority(next.priority)
          taskDraftBaselineRef.current = taskFormSnapshot(next)
          setSavedTaskCount(n => n + 1); setTaskDefaultsRemembered(true)
        } else {
          resetTaskDialog()
        }
      } else {
        resetTaskDialog()
      }
      // Mode "tambah lagi" sudah punya banner progres di dalam dialog. Toast
      // tambahan justru menumpuk di bawah layar dan bisa menutupi tombol simpan
      // berikutnya, jadi cukup toast untuk simpan & selesai / edit.
      if (!isAdd || mode !== 'again') toast(isAdd ? 'Tugas berhasil ditambahkan.' : 'Perubahan berhasil disimpan.', 'success')
      lastWriteTime.current = 0
      // Refresh berjalan di latar belakang; form berikutnya tidak menunggu cold start.
      void fetchData(false, true)
    } catch {
      // Hasil belum diketahui (bisa sudah commit, responsnya hilang). Kunci dan
      // draft dipertahankan supaya retry aman dan isian tidak hilang.
      setTaskFormError('Belum ada konfirmasi dari server. Isian tetap aman; tekan simpan untuk mencoba lagi tanpa menggandakan tugas.')
    } finally {
      savingTaskRef.current = false
      setSavingTask(false)
    }
  }

  // Keep failed/in-flight note drafts for this session when the detail is closed.
  const noteDraftsRef = useRef<Record<string, string>>({})
  const [, setNoteDraftRevision] = useState(0)
  const saveNotes = async (id: string, notes: string) => {
    noteDraftsRef.current[id] = notes
    setNoteDraftRevision(v => v + 1)
    // Capture previous notes for potential revert
    const prevNotes = tasks.find(t => t.id === id)?.notes || ''
    // Optimistic: update local notes immediately
    setTasks(prev => prev.map(t => t.id === id ? { ...t, notes } : t))
    try {
      const res = await api(`/api/tasks/${id}`, jsonOpts('PUT', { notes }))
      if (!res.ok) {
        toast('Gagal menyimpan catatan', 'error')
        // Revert server state in the list; the unsaved draft stays available.
        setTasks(prev => prev.map(t => t.id === id ? { ...t, notes: prevNotes } : t))
      } else if (noteDraftsRef.current[id] === notes) {
        delete noteDraftsRef.current[id]
        setNoteDraftRevision(v => v + 1)
      }
    } catch {
      toast('Gagal menyimpan catatan', 'error')
      // Revert optimistic update
      setTasks(prev => prev.map(t => t.id === id ? { ...t, notes: prevNotes } : t))
    }
  }

  const togglePin = async (task: Task) => {
    // Optimistic update first
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, pinned: !task.pinned } : t))
    lastWriteTime.current = Date.now()
    // No showGlobalLoading — optimistic update gives instant feedback
    try {
      const res = await api(`/api/tasks/${task.id}`, jsonOpts('PUT', { pinned: !task.pinned }))
      if (!res.ok) {
        toast('Gagal pin/unpin task', 'error')
        // Revert
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, pinned: task.pinned } : t))
        lastWriteTime.current = 0
        delayedFetch()
        return
      }
      delayedFetch()
    } catch {
      toast('Gagal pin/unpin task', 'error')
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, pinned: task.pinned } : t))
      lastWriteTime.current = 0
    }
  }

  /* ===== Fix #8: Duplicate Task ===== */
  const duplicateTask = async (t: Task) => {
    // Optimistic update first — create temp copy immediately
    let config = {}
    try { config = JSON.parse(t.scheduleConfig) } catch { /* use default */ }
    const tempId = 'temp-' + Date.now()
    const dupTask: Task = {
      id: tempId, name: t.name + ' (copy)', description: t.description, link: t.link,
      scheduleType: t.scheduleType, scheduleConfig: typeof config === 'string' ? config : JSON.stringify(config),
      notes: t.notes, pinned: false, priority: t.priority || 'medium',
      status: t.status === 'selesai' && (t.scheduleType === 'sekali' || t.scheduleType === 'tanggal_spesifik') ? 'selesai' : 'siap',
      nextReadyAt: t.nextReadyAt, lastCompletedAt: t.lastCompletedAt,
      cooldownRemaining: t.cooldownRemaining, cooldownMs: t.cooldownMs,
      project: t.project, createdAt: new Date().toISOString()
    }
    setTasks(prev => [dupTask, ...prev])
    if (t.project?.id) setExpandedProjects(prev => new Set(prev).add(t.project!.id))
    lastWriteTime.current = Date.now()
    // No showGlobalLoading — optimistic update gives instant feedback
    try {
      const res = await api('/api/tasks', jsonOpts('POST', {
        name: t.name + ' (copy)', description: t.description, link: t.link,
        scheduleType: t.scheduleType, scheduleConfig: config,
        projectId: t.project?.id, priority: t.priority || 'medium'
      }))
      if (!res.ok) {
        setTasks(prev => prev.filter(task => task.id !== tempId))
        lastWriteTime.current = 0
        toast('Gagal menduplikat task', 'error'); return
      }
      const data = await res.json()
      toast('Task diduplikat!', 'success')
      if (data.id) setTasks(prev => prev.map(task => task.id === tempId ? { ...task, id: data.id } : task))
      lastWriteTime.current = Date.now()
      delayedFetch()
    } catch {
      setTasks(prev => prev.filter(task => task.id !== tempId))
      lastWriteTime.current = 0
      toast('Gagal menduplikat task', 'error')
    }
  }

  /* ===== Fix #9: Move Task to Project ===== */
  const confirmMoveTask = async () => {
    if (!moveDialogTask || !moveTargetProjectId) return
    // Optimistic update FIRST
    const targetProj = projects.find(p => p.id === moveTargetProjectId)
    const taskId = moveDialogTask.id
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, project: targetProj ? { id: targetProj.id, name: targetProj.name, color: targetProj.color } : null } : t))
    if (targetProj) setExpandedProjects(prev => new Set(prev).add(targetProj.id))
    lastWriteTime.current = Date.now()
    setMoveDialogTask(null); setMoveTargetProjectId(null)
    // No showGlobalLoading — optimistic update gives instant feedback
    try {
      const res = await api(`/api/tasks/${taskId}`, jsonOpts('PUT', { projectId: moveTargetProjectId }))
      if (!res.ok) {
        toast('Gagal memindahkan task', 'error')
        lastWriteTime.current = 0
        delayedFetch()
        return
      }
      toast('Task dipindahkan!', 'success')
      delayedFetch()
    } catch { toast('Gagal memindahkan task', 'error'); lastWriteTime.current = 0; delayedFetch() }
  }

  /* ===== Fix #7: Batch Complete All Ready ===== */
  const batchComplete = (projectId: string) => {
    const readyTasks = tasks.filter(t => t.project?.id === projectId && t.status === 'siap')
    if (readyTasks.length === 0) { toast('Tidak ada task siap', 'info'); return }
    const proj = projects.find(p => p.id === projectId)
    setConfirmData({
      title: 'Complete Semua Siap',
      message: `Selesaikan ${readyTasks.length} task siap di "${proj?.name || '?'}"?`,
      onConfirm: async () => {
        const readyIds = new Set(readyTasks.map(t => t.id))
        // Optimistic: mark all as done immediately
        setTasks(prev => prev.map(t => readyIds.has(t.id) ? { ...t, status: 'selesai' as const, cooldownRemaining: '', cooldownMs: 0 } : t))
        lastWriteTime.current = Date.now()
        setBatchCompleting(projectId)
        // No showGlobalLoading — optimistic update gives instant feedback
        try {
          const results = await Promise.allSettled(readyTasks.map(t => api(`/api/tasks/${t.id}/complete`, { method: 'POST' })))
          const ok = results.filter(r => r.status === 'fulfilled' && r.value.ok).length
          const fail = results.length - ok
          const doneTokens = (await Promise.all(results.map(async (r, i) => {
            if (r.status !== 'fulfilled' || !r.value.ok) return null
            const body = await r.value.json().catch(() => ({}))
            return typeof body.logId === 'string' ? { id: readyTasks[i].id, logId: body.logId } : null
          }))).filter((t): t is CompletionToken => t !== null)
          if (fail === 0) {
            toast(`${ok} task sekaligus diselesaikan`, 'success', doneTokens.length ? {
              actionLabel: doneTokens.length === ok ? 'Undo semua' : 'Undo yang tersedia',
              onAction: () => undoManyComplete(doneTokens),
            } : undefined)
          } else {
            toast(`${ok} berhasil, ${fail} gagal`, 'error', doneTokens.length > 0 ? {
              actionLabel: 'Undo',
              onAction: () => undoManyComplete(doneTokens),
            } : undefined)
          }
          // Revert any that actually failed
          if (fail > 0) {
            const okIds = new Set<string>()
            results.forEach((r, i) => {
              if (r.status === 'fulfilled') {
                const val = r.value
                if (val && val.ok) okIds.add(readyTasks[i].id)
              }
            })
            const failedIds = new Set(readyIds) // Copy, not alias
            okIds.forEach(id => failedIds.delete(id))
            if (failedIds.size > 0) {
              setTasks(prev => prev.map(t => failedIds.has(t.id) ? { ...t, status: 'siap' as const } : t))
            }
          }
          lastWriteTime.current = Date.now()
          delayedFetch()
        } catch { toast('Gagal batch complete', 'error'); lastWriteTime.current = 0; delayedFetch() }
        setBatchCompleting(null)
        setConfirmData(null)
      }
    })
  }

  /* ===== Fix B1: Sort Projects A-Z / Default ===== */
  const sortedProjects = useMemo(() => {
    if (projectSort === 'az') {
      return [...projects].sort((a, b) => a.name.localeCompare(b.name))
    }
    return projects
  }, [projects, projectSort])

  /* ===== getActiveTasks: exclude archived sekali/tanggal_spesifik from active counts =====
     Aturannya sekarang tinggal di lib/task-counts supaya daftar, angka tab, dan
     ringkasan memakai definisi arsip yang sama. */
  // Must be defined BEFORE useMemo that references it (TDZ fix)
  const getActiveTasks = (pt: Task[]) => activeOnly(pt)

  /* ===== Memoized active task counts (performance — avoid re-computing on every render) ===== */
  const activeTasks = useMemo(() => getActiveTasks(tasks), [tasks])
  const totalSiap = useMemo(() => activeTasks.filter(t => t.status === 'siap').length, [activeTasks])
  const totalCd = useMemo(() => activeTasks.filter(t => t.status === 'cooldown').length, [activeTasks])
  // Ringkasan "Selesai" memakai hitungan yang sama dengan tab Selesai: semua
  // yang sudah dikerjakan, termasuk arsip tugas sekali. Dulu ringkasan hanya
  // menghitung tugas aktif, jadi tertulis 0 walau tab Selesai berisi banyak.
  const totalDone = useMemo(() => countDone(tasks), [tasks])
  const totalArchived = useMemo(() => tasks.length - activeOnly(tasks).length, [tasks])

  /* ===== Fix B8: Shared sort utility — pinned first, then priority ===== */
  const sortTasksByPriorityAndPin = (list: Task[]) => {
    const prioOrder = { high: 0, medium: 1, low: 2 }
    return [...list].sort((a, b) => {
      if (b.pinned !== a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      const ap = prioOrder[(a.priority || 'medium')] ?? 1
      const bp = prioOrder[(b.priority || 'medium')] ?? 1
      if (ap !== bp) return ap - bp
      return 0
    })
  }

  /* ===== Project CRUD ===== */
  const addProject = async (name: string, color: string) => {
    if (!name.trim() || savingProject) return
    // Optimistic update: show project IMMEDIATELY before API responds
    const tempId = 'temp-' + Date.now()
    setProjects(prev => [...prev, { id: tempId, name, color, _count: { tasks: 0 } }])
    setExpandedProjects(prev => new Set(prev).add(tempId))
    // CRITICAL: Set write timestamp IMMEDIATELY to prevent periodic sync from overwriting optimistic state
    lastWriteTime.current = Date.now()
    setSavingProject(true)
    // No global loading bar — optimistic update gives instant feedback
    try {
      const opts = { method: 'POST' as const, headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify({ name, color }), credentials: 'include' as RequestCredentials }
      const res = await fetch('/api/projects', opts)
      if (!res.ok) {
        // Revert optimistic update on failure
        setProjects(prev => prev.filter(p => p.id !== tempId))
        setExpandedProjects(prev => { const n = new Set(prev); n.delete(tempId); return n })
        lastWriteTime.current = 0 // Reset — allow next sync to fetch fresh data
        const err = await res.json().catch(() => ({})); toast('Gagal: ' + (err.error || res.statusText), 'error'); return
      }
      const data = await res.json()
      toast('Project ditambahkan!', 'success')
      // Replace temp ID with real ID
      setProjects(prev => prev.map(p => p.id === tempId ? { id: data.id, name: data.name, color: data.color, _count: { tasks: 0 } } : p))
      setExpandedProjects(prev => { const n = new Set(prev); n.delete(tempId); n.add(data.id); return n })
      // Langsung masuk ke proyek barunya: toolbar berubah jadi "+ Tugas di X"
      // dan empty state menawarkan "+ Tambah tugas di X" — tidak perlu mencari
      // proyeknya dulu di sidebar/Monitor.
      setViewMode('dashboard'); setActiveTab('all')
      setDashFilterProject(data.id); setDashFilterQuery(''); setSearchQuery('')
      setBulkSelected(new Set()); setSelectMode(false)
      lastWriteTime.current = Date.now()
      delayedFetch()
    } catch (e) {
      console.error(e)
      setProjects(prev => prev.filter(p => p.id !== tempId))
      setExpandedProjects(prev => { const n = new Set(prev); n.delete(tempId); return n })
      lastWriteTime.current = 0
      toast('Gagal membuat project', 'error')
    } finally { setSavingProject(false) }
  }

  const editProject = async (id: string, name: string, color: string) => {
    // Optimistic update first
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name, color } : p))
    lastWriteTime.current = Date.now()
    setDialogType(null)
    // No showGlobalLoading — optimistic update gives instant feedback
    try {
      const res = await api(`/api/projects/${id}`, jsonOpts('PUT', { name, color }))
      if (!res.ok) { toast('Gagal memperbarui project', 'error'); lastWriteTime.current = 0; delayedFetch(); return }
      toast('Project diperbarui!', 'success')
      delayedFetch()
    } catch { toast('Gagal memperbarui project', 'error'); lastWriteTime.current = 0; delayedFetch() }
  }

  const delProject = (p: Project) => {
    // Sebutkan jumlahnya, termasuk arsip: tugas sekali yang sudah selesai tidak
    // terlihat di daftar, jadi tanpa angka ini pengguna bisa menghapus puluhan
    // riwayat sambil mengira proyeknya kosong.
    const inside = tasks.filter(t => t.project?.id === p.id)
    const archived = inside.length - getActiveTasks(inside).length
    const rincian = inside.length === 0
      ? 'Proyek ini belum punya tugas.'
      : `${getActiveTasks(inside).length} tugas aktif${archived ? ` + ${archived} arsip` : ''} beserta riwayatnya ikut terhapus.`
    setConfirmData({
      title: 'Hapus Project', message: `Hapus project "${p.name}"? ${rincian}`,
      onConfirm: async () => {
        setConfirmLoading(true)
        // Optimistic delete FIRST — prevent sync from re-adding it
        const deletedTaskIds = new Set(tasks.filter(t => t.project?.id === p.id).map(t => t.id))
        setProjects(prev => prev.filter(proj => proj.id !== p.id))
        setTasks(prev => prev.filter(t => t.project?.id !== p.id))
        setExpandedProjects(prev => { const n = new Set(prev); n.delete(p.id); return n })
        if (selectedTaskId && deletedTaskIds.has(selectedTaskId)) {
          setSelectedTaskId(null)
          detailRef.current = null
        }
        if (dialogType === 'edit' || dialogType === 'detail') {
          const currentTask = tasks.find(t => t.id === selectedTaskId)
          if (currentTask?.project?.id === p.id) {
            setDialogType(null)
          }
        }
        lastWriteTime.current = Date.now()
        let success = false
        try {
          const res = await api(`/api/projects/${p.id}`, { method: 'DELETE' })
          if (res.ok || res.status === 404) { success = true }
          else { toast('Gagal menghapus project', 'error'); lastWriteTime.current = 0; delayedFetch() }
        } catch { toast('Gagal menghapus project (jaringan)', 'error'); lastWriteTime.current = 0; delayedFetch() }
        finally {
          setConfirmLoading(false)
          setConfirmData(null)
          if (success) { toast('Project dihapus!', 'success'); delayedFetch() }
        }
      }
    })
  }

  /* ===== Export / Import ===== */
  // Robust download helper — triggers download with cleanup
  const downloadBlob = (blob: Blob, filename: string) => {
    const u = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = u; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(u), 1000)
  }

  const doExport = async () => {
    try {
      const r = await api('/api/export')
      if (!r.ok) { toast('Gagal export', 'error'); return }
      const b = await r.blob()
      downloadBlob(b, `mbg-backup-${new Date().toISOString().slice(0, 10)}.json`)
      toast('Backup diunduh!', 'success')
    } catch { toast('Gagal mengunduh backup', 'error') }
  }

  const doImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    try {
      const d = JSON.parse(await f.text())
      if (!d.tasks) { toast('Format file salah', 'error'); return }
      const r = await api('/api/import', jsonOpts('POST', d))
      if (!r.ok) { const err = await r.json().catch(() => ({})); toast('Gagal: ' + (err.error || r.statusText), 'error'); return }
      const res = await r.json()
      if (res.success) { toast(`Import: ${res.imported.projects} project, ${res.imported.tasks} task`); fetchData() }
      else toast('Gagal: ' + (res.error || ''))
    } catch { toast('File tidak valid', 'error') }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /* ===== Per-Project Export / Import ===== */
  const doExportProject = async (projectId: string) => {
    try {
      const r = await api(`/api/projects/${projectId}/export`)
      if (!r.ok) { toast('Gagal export', 'error'); return }
      const d = await r.json()
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
      downloadBlob(blob, `mbg-project-${(d.project?.name || 'export').replace(/[<>:"/\\|?*\x00]/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`)
      toast('Project diunduh!', 'success')
    } catch { toast('Gagal export project', 'error') }
  }

  const doImportProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    try {
      const d = JSON.parse(await f.text())
      if (!d.project || !d.tasks) { toast('Format file salah', 'error'); return }
      const body = { ...d, targetProjectId: projectImportTargetRef.current || undefined }
      const r = await api('/api/projects/import', jsonOpts('POST', body))
      if (!r.ok) { const err = await r.json().catch(() => ({})); toast('Gagal: ' + (err.error || r.statusText), 'error'); return }
      const res = await r.json()
      if (res.success) { toast(`Import: ${res.taskCount} task ke project "${res.projectName}"`); fetchData() }
      else toast('Gagal: ' + (res.error || ''))
    } catch { toast('File tidak valid', 'error') }
    if (fileInputProjectImportRef.current) fileInputProjectImportRef.current.value = ''
    projectImportTargetRef.current = null
  }

  /* ===== Telegram ===== */
  /* ===== Pengingat: satu layar, satu tujuan =====
     Sebelumnya "Nyalakan pengingat" membuka Pengaturan umum yang checkbox
     push-nya SUDAH tercentang walau push belum aktif. Menekan OK tidak meminta
     izin apa pun, jadi pengguna harus tahu sendiri untuk menghapus lalu
     mencentang ulang. Di sini status ditampilkan apa adanya dan tiap jalur
     punya satu tombol yang benar-benar melakukan aksinya. */
  // Kemampuan browser ditentukan dari fitur yang ada, BUKAN dari pushSupported.
  // pushSupported baru bernilai true setelah pendaftaran berjalan, sehingga
  // memakainya di sini sempat membuat Chrome dilaporkan "belum mendukung".
  const pushCapable = typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof window !== 'undefined' && 'PushManager' in window
  const pushStatus: 'active' | 'need-permission' | 'blocked' | 'unsupported' | 'no-key' | 'setup-failed' =
    !pushCapable ? 'unsupported'
      : pushSetupFailed ? 'setup-failed'
        : notifPermission === 'denied' ? 'blocked'
          : pushEnabled ? 'active'
            // Dicek sebelum 'need-permission': tanpa kunci server, meminta izin
            // browser hanya menghasilkan izin yang tidak berguna.
            : pushServerConfigured === false ? 'no-key'
              : notifPermission === 'granted' ? 'no-key'
                : 'need-permission'

  // Diperiksa saat dialog dibuka, bukan lewat effect, supaya tidak memanggil
  // setState di dalam effect. Kegagalan jaringan dibiarkan null agar tidak
  // menuduh server belum dikonfigurasi padahal cuma sedang offline.
  const probePushConfig = async () => {
    try {
      const r = await fetch('/api/push/vapid-key', { credentials: 'include' })
      if (!r.ok) { setPushServerConfigured(false); return }
      const d = await r.json()
      setPushServerConfigured(Boolean(d?.publicKey))
    } catch { setPushServerConfigured(null) }
  }

  const openReminders = () => {
    setDialogType('reminders')
    // Izin bisa berubah lewat setelan browser sejak halaman dibuka.
    if (typeof Notification !== 'undefined') setNotifPermission(Notification.permission)
    void probePushConfig()
  }

  const enablePushReminder = async () => {
    if (!authUser?.id) return
    // Izin dulu, baru simpan preferensi. Versi sebelumnya menyimpan lebih dulu,
    // sehingga kalau pengguna menolak, server tetap mencatat notifikasi aktif —
    // persis keadaan menyesatkan yang ingin dihapus dialog ini.
    await requestNotifPermission()
    const perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied'
    if (perm !== 'granted') return
    try { await api('/api/settings', jsonOpts('PUT', { browserNotifEnabled: true })) } catch { /* izin sudah diberikan; lanjut */ }
    setFormBrowserNotif(true)
    await registerPushSubscription(authUser.id)
    delayedFetch()
  }

  const genCode = async () => {
    if (codeGenerating) return; setCodeGenerating(true)
    try { const r = await api('/api/generate-code', { method: 'POST' }); if (!r.ok) { toast('Gagal generate kode', 'error'); return }; const d = await r.json(); if (d.code) setTelegramCode(d.code) }
    catch { toast('Gagal', 'error') }
    finally { setCodeGenerating(false) }
  }

  const testTelegram = async () => {
    if (telegramTesting) return; setTelegramTesting(true)
    try {
      const r = await api('/api/telegram/notify', jsonOpts('POST', { message: '🔔 Test Notifikasi MBG\n\nTelegram berhasil terhubung!' }))
      if (!r.ok) { const err = await r.json().catch(() => ({})); toast('Gagal: ' + (err.error || r.statusText), 'error'); return }
      const d = await r.json()
      if (d.success) toast('Notifikasi terkirim!', 'success')
      else toast('Gagal: ' + (d.error || ''))
    } catch { toast('Gagal kirim notifikasi', 'error') }
    finally { setTelegramTesting(false) }
  }

  const saveTelegramBotUsername = async () => {
    // Optimistic: update local setting immediately
    setTelegramBotUsername(telegramBotUsername.trim())
    try {
      const res = await api('/api/settings', jsonOpts('PUT', { telegramBotUsername: telegramBotUsername.trim() }))
      if (!res.ok) { toast('Gagal menyimpan', 'error'); return }
      toast('Bot username disimpan!', 'success')
    } catch { toast('Gagal menyimpan', 'error') }
  }

  /* ===== Fix B4: Open link FIRST (avoid popup blocker), then complete ===== */
  /* Buka link tugas lalu ingat tugasnya. Ketika pengguna kembali, app menawarkan
     "Sudah selesai?" supaya tidak perlu mencari barisnya lagi. */
  const openTaskLink = (t: Task) => {
    if (!isSafeHttpUrl(t.link)) { toast('Link tidak valid; edit tugas untuk memperbaikinya', 'error'); return }
    window.open(t.link, '_blank', 'noopener,noreferrer')
    if (t.status === 'siap') { setReturnTaskId(t.id); returnTaskRef.current = t.id }
  }

  const completeAndOpenLink = async (t: Task) => {
    // Open link FIRST while still in user click context (avoids popup blocker)
    if (!isSafeHttpUrl(t.link)) { toast('Link tidak valid; edit tugas untuk memperbaikinya', 'error'); return }
    window.open(t.link, '_blank', 'noopener,noreferrer')
    if (t.status === 'siap') {
      await complete(t.id)
    }
  }

  /* ===== Kerjakan (Work on Task) ===== */
  const startWorking = (t: Task) => {
    if (t.status !== 'siap') return
    cancelWorking()
    workingActiveRef.current = true // Mark working as active
    setWorkingTaskId(t.id)
    setWorkingCountdown(10)
    setWorkingCompleted(false)
    setUndoCountdown(0)
    if (t.project?.id) setExpandedProjects(prev => new Set(prev).add(t.project!.id))
    if (isSafeHttpUrl(t.link)) window.open(t.link, '_blank', 'noopener,noreferrer')
    let count = 10
    workingTimerRef.current = setInterval(async () => {
      count--
      setWorkingCountdown(count)
      if (count <= 0) {
        if (workingTimerRef.current) { clearInterval(workingTimerRef.current); workingTimerRef.current = null }
        try {
          const logId = await complete(t.id)
          if (!logId) { cancelWorking(); return }
          workingCompletionRef.current = logId
          // Guard: if user cancelled during the await, don't show undo UI
          if (!workingActiveRef.current) return
          setWorkingCompleted(true)
          // Mulai countdown undo 60 detik
          let undoSec = 60
          setUndoCountdown(undoSec)
          undoTimerRef.current = setInterval(() => {
            undoSec--
            setUndoCountdown(undoSec)
            if (undoSec <= 0) {
              if (undoTimerRef.current) { clearInterval(undoTimerRef.current); undoTimerRef.current = null }
              setWorkingTaskId(null)
              setWorkingCompleted(false)
              setUndoCountdown(0)
            }
          }, 1000)
        } catch {
          if (!workingActiveRef.current) return
          toast('Gagal menyelesaikan task', 'error')
          setWorkingTaskId(null)
          setWorkingCountdown(10)
          setWorkingCompleted(false)
          setUndoCountdown(0)
        }
      }
    }, 1000)
  }

  const cancelWorking = () => {
    workingActiveRef.current = false // Mark working as cancelled
    if (workingTimerRef.current) { clearInterval(workingTimerRef.current); workingTimerRef.current = null }
    if (undoTimerRef.current) { clearInterval(undoTimerRef.current); undoTimerRef.current = null }
    setWorkingTaskId(null)
    setWorkingCountdown(10)
    setWorkingCompleted(false)
    setUndoCountdown(0)
  }

  /* Fix B3: undoWorkingComplete deletes last log instead of full reset */
  const undoWorkingComplete = async () => {
    if (workingTaskId) {
      // Only undo the completion created by this timer.
      const logId = workingCompletionRef.current
      cancelWorking()
      if (!logId) { toast('Penyelesaian tidak tersedia untuk dibatalkan', 'error'); return }
      try {
        const res = await api(`/api/tasks/${workingTaskId}/undo`, jsonOpts('POST', { logId }))
        if (!res.ok) { toast('Gagal membatalkan task', 'error'); delayedFetch(); return }
        toast('Task dibatalkan!', 'success')
        delayedFetch()
      } catch { toast('Gagal membatalkan task', 'error'); delayedFetch() }
      return
    }
    cancelWorking()
  }

  /* ===== Share Project ===== */
  const openShareProject = (p: Project) => {
    setShareCode('')
    setShareProjectName(p.name)
    setShareTaskCount(0)
    setSelectedTaskId(p.id)
    setDialogType('share')
  }

  const doShareProject = async () => {
    if (!selectedTaskId || shareLoading) return
    setShareLoading(true)
    // No global loading — shareLoading state handles UI feedback
    try {
      const res = await api(`/api/projects/${selectedTaskId}/share`, { method: 'POST' })
      if (!res.ok) { const err = await res.json().catch(() => ({})); toast('Gagal: ' + (err.error || '')); return }
      const data = await res.json()
      setShareCode(data.code)
      setShareTaskCount(data.taskCount)
    } catch { toast('Gagal share', 'error') }
    finally { setShareLoading(false); setConfirmData(null) }
  }

  const copyShareCode = () => {
    if (!shareCode) return
    navigator.clipboard.writeText(shareCode).then(() => toast('Kode disalin!', 'success')).catch(() => toast('Gagal salin', 'error'))
  }

  /* ===== Import Share ===== */
  const openImportShare = () => {
    setImportCode('')
    setImportPreview(null)
    setDialogType('import-share')
  }

  const checkShareCode = async () => {
    const code = importCode.trim().toUpperCase()
    if (code.length !== 6) { toast('Kode harus 6 karakter', 'error'); return }
    setImportChecking(true)
    // No global loading — importChecking state handles UI feedback
    try {
      const res = await api(`/api/share/${code}`)
      if (!res.ok) { const err = await res.json().catch(() => ({})); toast(err.error || 'Kode tidak valid', 'error'); setImportPreview(null); return }
      const data = await res.json()
      setImportPreview({ project: data.project, taskCount: data.taskCount })
    } catch { toast('Gagal cek kode', 'error') }
    finally { setImportChecking(false) }
  }

  const doImportShare = async () => {
    const code = importCode.trim().toUpperCase()
    if (!importPreview || importLoading) return
    setImportLoading(true)
    // No global loading — importLoading state handles UI feedback
    try {
      const res = await api(`/api/share/${code}/import`, { method: 'POST' })
      if (!res.ok) { const err = await res.json().catch(() => ({})); toast('Gagal: ' + (err.error || '')); return }
      const data = await res.json()
      toast(`Import: "${data.projectName}" (${data.taskCount} task)`)
      setDialogType(null)
      fetchData()
    } catch { toast('Gagal import', 'error') }
    finally { setImportLoading(false) }
  }

  /* ===== Notes CRUD ===== */
  const saveNote = async () => {
    if (!noteFormContent.trim()) { toast('Isi catatan dulu!', 'error'); return }
    // Optimistic: add/update note locally immediately
    if (editingNoteId) {
      setNotes(prev => prev.map(n => n.id === editingNoteId ? { ...n, content: noteFormContent, color: noteFormColor } : n))
    } else {
      const tempId = 'temp-note-' + Date.now()
      setNotes(prev => [{ id: tempId, content: noteFormContent, color: noteFormColor, pinned: false, userId: authUser?.id || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Note, ...prev])
    }
    toast(editingNoteId ? 'Catatan diperbarui!' : 'Catatan ditambahkan!', 'success')
    setNoteFormContent(''); setNoteFormColor('#FFFFCC'); setEditingNoteId(null)
    try {
      let res: Response
      if (editingNoteId) {
        res = await api(`/api/notes/${editingNoteId}`, jsonOpts('PUT', { content: noteFormContent, color: noteFormColor }))
      } else {
        res = await api('/api/notes', jsonOpts('POST', { content: noteFormContent, color: noteFormColor }))
      }
      if (!res.ok) { toast('Gagal simpan catatan', 'error'); fetchNotes(); return }
      fetchNotes()
    } catch { toast('Gagal simpan catatan', 'error'); fetchNotes() }
  }

  const deleteNote = (id: string) => {
    setConfirmData({
      title: 'Hapus Catatan', message: 'Yakin hapus catatan ini?',
      onConfirm: async () => {
        // Close dialog FIRST
        setConfirmData(null)
        // Optimistic: remove note locally immediately
        setNotes(prev => prev.filter(n => n.id !== id))
        toast('Catatan dihapus!', 'success')
        try { const res = await api(`/api/notes/${id}`, { method: 'DELETE' }); if (!res.ok) { toast('Gagal menghapus', 'error'); fetchNotes(); return } fetchNotes() }
        catch { toast('Gagal', 'error'); fetchNotes() }
      }
    })
  }

  const toggleNotePin = async (note: Note) => {
    // Optimistic: toggle pin locally immediately
    setNotes(prev => prev.map(n => n.id === note.id ? { ...n, pinned: !note.pinned } : n))
    try { const res = await api(`/api/notes/${note.id}`, jsonOpts('PUT', { pinned: !note.pinned })); if (!res.ok) { toast('Gagal', 'error'); fetchNotes(); return } fetchNotes() } catch { toast('Gagal', 'error'); fetchNotes() }
  }

  const openEditNote = (note: Note) => {
    setNoteFormContent(note.content); setNoteFormColor(note.color); setEditingNoteId(note.id)
  }

  const handleLogout = () => {
    setConfirmData({
      title: 'Logout', message: `Yakin ingin logout dari "${authUser?.username}"?`,
      onConfirm: async () => {
        cancelWorking()
        setBatchCompleting(null)
        // Bar konfirmasi "sudah selesai?" milik akun yang sedang login. Tanpa
        // ini id-nya bertahan sampai sesi berikutnya di perangkat yang sama.
        setReturnPromptOpen(false)
        setReturnTaskId(null)
        returnTaskRef.current = null
        try { await api('/api/logout', { method: 'POST' }) } catch { /* server unreachable, proceed with local logout */ }
        setProfileMenuOpen(false)
        setConfirmData(null)
        setAuthenticated(false)
        setAuthUser(null)
        persistAuth(null)
        clearCache() // Clear user's cached data on logout
        taskDefaultsRef.current.clear()
        resetTaskDialog()
        setTasks([])
        setProjects([])
        setNotes([])
        setLoading(false)
      }
    })
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginUsername.trim() || !loginPassword.trim()) { setAuthError('Username dan password wajib diisi'); return }
    setAuthLoading(true)
    showGlobalLoading()
    setAuthError('')
    try {
      const res = await api('/api/auth/login', jsonOpts('POST', { username: loginUsername.trim(), password: loginPassword }))
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Sebelumnya pesan asli server dibuang dan selalu diganti "Periksa
        // username dan password" — padahal penyebabnya bisa database atau
        // rate limit, sehingga pemilik instalasi menghabiskan waktu menebak
        // password yang sebenarnya sudah benar. Untuk 401 server tetap menjawab
        // generik agar tidak membocorkan apakah sebuah username terdaftar.
        setAuthError(data.error || `Login gagal (HTTP ${res.status}). Coba lagi atau hubungi admin.`)
        return
      }
      if (data.success) {
        setAuthenticated(true)
        setAuthUser(data.user)
        persistAuth(data.user)
        setLoginUsername(''); setLoginPassword('')
        fetchData(false, true)
        fetchNotes()
      } else {
        setAuthError(data.error || 'Login gagal')
      }
    } catch { setAuthError('Gagal terhubung ke server') }
    finally { setAuthLoading(false); hideGlobalLoading() }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bootstrapMode && !registerInviteCode.trim()) { setAuthError('Kode undangan wajib diisi. Minta kode ke admin.'); return }
    if (!registerUsername.trim() || !registerPassword.trim()) { setAuthError('Username dan password wajib diisi'); return }
    if (registerUsername.trim().length < 3) { setAuthError('Username minimal 3 karakter'); return }
    if (registerPassword.length < 6) { setAuthError('Password minimal 6 karakter'); return }
    setAuthLoading(true)
    showGlobalLoading()
    setAuthError('')
    try {
      const res = await api('/api/auth/register', jsonOpts('POST', {
        username: registerUsername.trim(),
        password: registerPassword,
        displayName: registerDisplayName.trim() || null,
        inviteCode: registerInviteCode.trim()
      }))
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Tampilkan pesan asli dari server (mis. "Kode undangan sudah digunakan")
        // supaya user tahu apa yang salah, bukan "coba lagi" yang tidak informatif.
        setAuthError(data.error || `Registrasi gagal (HTTP ${res.status}). Coba lagi atau hubungi admin.`)
        return
      }
      if (data.success) {
        setAuthenticated(true)
        setAuthUser(data.user)
        persistAuth(data.user)
        setRegisterUsername(''); setRegisterPassword(''); setRegisterDisplayName(''); setRegisterInviteCode('')
        fetchData(false, true)
        fetchNotes()
      } else {
        setAuthError(data.error || 'Registrasi gagal')
      }
    } catch { setAuthError('Gagal terhubung ke server') }
    finally { setAuthLoading(false); hideGlobalLoading() }
  }

  /* ===== Admin Panel ===== */
  const isAdmin = authUser?.role === 'ADMIN'

  const fetchAdminData = async () => {
    if (!isAdmin) return
    setAdminLoading(true)
    try {
      const [usersRes, codesRes] = await Promise.all([
        api('/api/admin/users'),
        api('/api/admin/invite-codes')
      ])
      if (usersRes.ok) setAdminUsers(await usersRes.json())
      if (codesRes.ok) setAdminInviteCodes(await codesRes.json())
    } catch { toast('Gagal memuat data admin', 'error') }
    finally { setAdminLoading(false) }
  }

  const openAdminPanel = () => {
    setDialogType('admin')
    fetchAdminData()
  }

  const toggleBlockUser = async (user: { id: string; username: string; isBlocked: boolean }) => {
    // Optimistic: toggle block status locally immediately
    setAdminUsers(prev => prev.map(u => u.id === user.id ? { ...u, isBlocked: !u.isBlocked } : u))
    toast(user.isBlocked ? `${user.username} di-unblock` : `${user.username} di-block`)
    try {
      const res = await api(`/api/admin/users/${user.id}`, jsonOpts('PUT', { isBlocked: !user.isBlocked }))
      if (!res.ok) { toast('Gagal mengubah status user', 'error'); fetchAdminData(); return }
      fetchAdminData()
    } catch { toast('Gagal', 'error'); fetchAdminData() }
  }

  const createUserInviteCode = async (role: string) => {
    // No global loading — toast is sufficient feedback
    try {
      const res = await api('/api/admin/invite-codes', jsonOpts('POST', { role }))
      if (res.ok) {
        toast(`Kode ${role} dibuat!`)
        fetchAdminData()
      } else {
        const err = await res.json().catch(() => ({}))
        toast('Gagal: ' + (err.error || ''))
      }
    } catch { toast('Gagal membuat kode', 'error') }
  }

  const deleteInviteCode = async (code: { id: string; code: string }) => {
    // Optimistic: remove code locally immediately
    setAdminInviteCodes(prev => prev.filter(c => c.id !== code.id))
    toast(`Kode ${code.code} dihapus`)
    try {
      const res = await api(`/api/admin/invite-codes/${code.id}`, { method: 'DELETE' })
      if (res.ok) { fetchAdminData() }
      else { toast('Gagal menghapus', 'error'); fetchAdminData() }
    } catch { toast('Gagal', 'error'); fetchAdminData() }
  }

  /* ===== Settings ===== */
  const saveSettings = async () => {
    // Capture previous settings for potential revert
    const prevSettings = { ...settings }
    // Optimistic: apply settings locally immediately
    const newSettings = { ...settings, timezone: formTimezone, timeFormat: formTimeFormat, autoExpandSiap: formAutoExpandSiap, autoCompleteLink: formAutoCompleteLink, telegramNotifEnabled: formTelegramNotif, browserNotifEnabled: formBrowserNotif, notifyBeforeCooldownMin: formNotifyBeforeMin, audioAlertEnabled: formAudioAlertEnabled }
    setSettings(newSettings)
    try {
      const res = await api('/api/settings', jsonOpts('PUT', { timezone: formTimezone, timeFormat: formTimeFormat, autoExpandSiap: formAutoExpandSiap, autoCompleteLink: formAutoCompleteLink, telegramNotifEnabled: formTelegramNotif, browserNotifEnabled: formBrowserNotif, notifyBeforeCooldownMin: formNotifyBeforeMin, audioAlertEnabled: formAudioAlertEnabled }))
      if (!res.ok) {
        toast('Gagal menyimpan di server', 'error')
        // Revert optimistic update
        setSettings(prevSettings)
        return
      }
      // Only show success and close dialog AFTER server confirms
      toast('Disimpan!', 'success')
      setDialogType(null)
      // If user disabled browser notif, unregister push subscription
      if (formBrowserNotif !== settings.browserNotifEnabled && !formBrowserNotif) {
        unregisterPushSubscription()
      }
      delayedFetch()
    } catch {
      toast('Gagal menyimpan di server', 'error')
      // Revert optimistic update
      setSettings(prevSettings)
    }
  }

  /* ===== Openers ===== */
  const openAdd = (projectId: string | null) => {
    if (savingTaskRef.current) return
    // Sentinel filter '__no_project__' bukan id proyek asli — normalkan dulu.
    const pid = projectIdForNewTask(projectId)
    const defaults = readTaskDefaults(taskDefaultsRef.current, authUser?.id, pid)
    const form = emptyTaskForm(pid, defaults)
    setTaskFormError(''); setSelectedTaskId(null)
    setFormProjectId(form.projectId)
    setFormName(form.name); setFormDesc(form.description); setFormLink(form.link)
    setFormScheduleType(form.scheduleType); setFormScheduleConfig(form.scheduleConfig)
    setFormPriority(form.priority)
    taskRequestRef.current = null
    taskDraftBaselineRef.current = taskFormSnapshot(form)
    setSavedTaskCount(0); setTaskDefaultsRemembered(taskDefaultsRef.current.has(taskDefaultsKey(authUser?.id, pid)))
    setDialogType('add')
    // Buka folder tujuannya supaya tugas yang baru dibuat langsung terlihat.
    setExpandedProjects(prev => new Set(prev).add(pid ?? NO_PROJECT_FILTER))
  }
  const openAddStandalone = () => {
    openAdd(null)
  }
  // Tombol "Tugas Baru" mengikuti filter proyek yang sedang aktif: kalau sedang
  // melihat satu proyek, tugas baru masuk ke proyek itu (perilaku pintasan N).
  const openAddForCurrentFilter = () => {
    openAdd(dashFilterProject)
  }

  const openEdit = (t: Task) => {
    if (savingTaskRef.current) return
    setTaskFormError('')
    setFormName(t.name); setFormDesc(t.description || ''); setFormLink(t.link || '')
    setFormScheduleType(t.scheduleType)
    let config: Record<string, unknown> = {}
    try { const parsed = JSON.parse(t.scheduleConfig); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed } catch { /* jadwal rusak → kosong */ }
    setFormScheduleConfig(config)
    setFormProjectId(t.project?.id || null)
    setFormPriority(t.priority || 'medium')
    taskRequestRef.current = null; setSavedTaskCount(0); setTaskDefaultsRemembered(false)
    taskDraftBaselineRef.current = taskFormSnapshot({ name: t.name, description: t.description || '', link: t.link || '', scheduleType: t.scheduleType, scheduleConfig: config, projectId: t.project?.id || null, priority: t.priority || 'medium' })
    setSelectedTaskId(t.id); setDialogType('edit')
  }
  const openDetail = (t: Task) => { if (Date.now() - ctxOpenTimeRef.current < 300) return; detailRef.current = t; setSelectedTaskId(t.id); setDialogType('detail') }
  const openEditProject = (p: Project) => { setFormProjectName(p.name); setFormProjectColor(p.color); setSelectedTaskId(p.id); setDialogType('edit-project') }
  const openAddProject = () => { setFormProjectName(''); setFormProjectColor('#000080'); setDialogType('add-project') }
  // Kunci per akun supaya perangkat bersama tidak saling menimpa pilihan.
  const reminderNudgeKey = authUser?.id ? `mbg_reminder_nudge_${authUser.id}` : null
  const dismissReminderNudge = () => {
    setReminderNudgeHidden(true)
    if (reminderNudgeKey) { try { localStorage.setItem(reminderNudgeKey, 'dismissed') } catch { /* penyimpanan penuh — abaikan */ } }
  }

  const openSettings = () => { const s = settings as Record<string, unknown>; setFormTimezone(['WIB', 'WITA', 'WIT'].includes(s.timezone as string) ? (s.timezone as string) : 'WIB'); setFormTimeFormat(s.timeFormat === '12' ? '12' : '24'); setFormAutoExpandSiap(s.autoExpandSiap !== false); setFormAutoCompleteLink(s.autoCompleteLink === true); setFormTelegramNotif(s.telegramNotifEnabled !== false); setFormBrowserNotif(s.browserNotifEnabled !== false); setFormNotifyBeforeMin((s.notifyBeforeCooldownMin as number) || 5); setFormAudioAlertEnabled(s.audioAlertEnabled !== false); setDialogType('settings') }

  /* ===== Folder toggle ===== */

  /* ===== Project stats helper (excludes archived sekali from active counts) ===== */
  const getProjectStats = (projectId: string) => {
    const pt = tasks.filter(t => t.project?.id === projectId)
    const active = getActiveTasks(pt)
    const archivedSekali = pt.filter(t => t.status === 'selesai' && (t.scheduleType === 'sekali' || t.scheduleType === 'tanggal_spesifik')).length
    return {
      total: active.length,
      siap: active.filter(t => t.status === 'siap').length,
      cd: active.filter(t => t.status === 'cooldown').length,
      done: active.filter(t => t.status === 'selesai').length,
      archived: archivedSekali
    }
  }

  /* ===== Context menus ===== */
  const handleCtx = (e: React.MouseEvent, t: Task) => {
    e.preventDefault()
    e.stopPropagation()
    ctxOpenTimeRef.current = Date.now()
    setSelectedTaskId(t.id)
    setProjectContextMenu(null) // Close project context menu if open
    const pos = clampPos(e.clientX, e.clientY)
    setContextMenu({ x: pos.x, y: pos.y, task: t })
  }
  const handleProjCtx = (e: React.MouseEvent, p: Project) => {
    e.preventDefault()
    e.stopPropagation()
    ctxOpenTimeRef.current = Date.now()
    setSelectedTaskId(p.id)
    setContextMenu(null) // Close task context menu if open
    const pos = clampPos(e.clientX, e.clientY)
    setProjectContextMenu({ x: pos.x, y: pos.y, project: p })
  }
  // Klik biasa pada baris proyek = filter. Setelah long-press membuka menu,
  // browser mengirim klik sintetis saat jari diangkat — jangan sampai klik itu
  // langsung menutup menu yang baru dibuka / mengganti filter.
  const selectProjectFilter = (id: string | null) => {
    if (Date.now() - ctxOpenTimeRef.current < 300) return
    clearBulk(); setDashFilterProject(id); setDashFilterQuery('')
  }

  /* ===== Long-press handlers for mobile context menu ===== */
  const handleTouchStart = (e: React.TouchEvent, t: Task) => {
    const touch = e.touches[0]
    // Cancel any existing long-press timer (prevents ghost context menus when switching between task/project)
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
    longPressPosRef.current = { x: touch.clientX, y: touch.clientY }
    longPressMovedRef.current = false
    longPressTaskRef.current = t
    longPressTimerRef.current = setTimeout(() => {
      if (!longPressMovedRef.current && longPressTaskRef.current) {
        const task = longPressTaskRef.current
        ctxOpenTimeRef.current = Date.now()
        setSelectedTaskId(task.id)
        const pos = clampPos(longPressPosRef.current.x, longPressPosRef.current.y)
        setContextMenu({ x: pos.x, y: pos.y, task })
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30)
      }
    }, 500)
  }

  const handleProjTouchStart = (e: React.TouchEvent, p: Project) => {
    const touch = e.touches[0]
    // Cancel any existing long-press timer (prevents ghost context menus when switching between task/project)
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
    setContextMenu(null) // tutup menu task kalau sedang terbuka
    longPressPosRef.current = { x: touch.clientX, y: touch.clientY }
    longPressMovedRef.current = false
    longPressProjectRef.current = p
    longPressTimerRef.current = setTimeout(() => {
      if (!longPressMovedRef.current && longPressProjectRef.current) {
        const proj = longPressProjectRef.current
        ctxOpenTimeRef.current = Date.now()
        const pos = clampPos(longPressPosRef.current.x, longPressPosRef.current.y)
        setProjectContextMenu({ x: pos.x, y: pos.y, project: proj })
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30)
      }
    }, 500)
  }

  const handleTouchMove = () => {
    longPressMovedRef.current = true
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
  }

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
  }

  useEffect(() => {
    const c = (e: MouseEvent) => {
      // Don't close menu if clicking inside a menu bar item, dropdown, or titlebar button
      // React's e.stopPropagation() on synthetic events does NOT stop native document listeners
      const target = e.target as HTMLElement
      if (target.closest('.win95-menubar-item') || target.closest('.win95-dropdown') || target.closest('.win95-titlebar-btn') || target.closest('.win95-context-menu')) return
      // Long-press selesai → browser mengirim klik sintetis saat jari diangkat.
      // Tanpa penjaga ini menu yang BARU dibuka langsung ditutup lagi.
      if (Date.now() - ctxOpenTimeRef.current < 300) return
      setContextMenu(null); setProjectContextMenu(null); setOpenMenu(null); setProfileMenuOpen(false)
    }
    document.addEventListener('click', c); return () => document.removeEventListener('click', c)
  }, [])

  /* ===== Auto-clamp context menus & profile dropdown to viewport ===== */
  useEffect(() => {
    // Use rAF to ensure DOM has updated after React render
    const raf = requestAnimationFrame(() => {
      clampElementToViewport(taskCtxRef.current)
      clampElementToViewport(projCtxRef.current)
      clampElementToViewport(profileDropRef.current)
    })
    return () => cancelAnimationFrame(raf)
  }, [contextMenu, projectContextMenu, profileMenuOpen])

  /* ===== Template CRUD ===== */
  const saveTemplate = async () => {
    if (!formTemplateName.trim()) { toast('Nama template wajib diisi!', 'error'); return }
    const scheduleError = scheduleInputError(formTemplateScheduleType, formTemplateScheduleConfig)
    if (scheduleError) { toast(scheduleError, 'error'); return }
    // BUG FIX: Capture form values BEFORE resetting to avoid fragile closure behavior
    const tplName = formTemplateName.trim()
    const tplDesc = formTemplateDesc || null
    const tplLink = formTemplateLink || null
    const tplScheduleType = formTemplateScheduleType
    const tplScheduleConfig = formTemplateScheduleConfig
    const tplPriority = formTemplatePriority
    const tplEditId = editingTemplate?.id
    // Optimistic: update template list locally immediately
    const newTemplate: TaskTemplate = {
      id: tplEditId || 'temp-tpl-' + Date.now(),
      name: tplName, description: tplDesc, link: tplLink,
      scheduleType: tplScheduleType, scheduleConfig: JSON.stringify(tplScheduleConfig), priority: tplPriority,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    if (tplEditId) {
      setTemplates(prev => prev.map(t => t.id === tplEditId ? newTemplate : t))
      toast('Template diperbarui!', 'success')
    } else {
      setTemplates(prev => [newTemplate, ...prev])
      toast('Template ditambahkan!', 'success')
    }
    setFormTemplateName(''); setFormTemplateDesc(''); setFormTemplateLink('')
    setFormTemplateScheduleType('sekali'); setFormTemplateScheduleConfig({}); setFormTemplatePriority('medium')
    setEditingTemplate(null); setTemplateDialogOpen(false)
    try {
      let res: Response
      if (tplEditId) {
        res = await api(`/api/templates/${tplEditId}`, jsonOpts('PUT', {
          name: tplName, description: tplDesc, link: tplLink,
          scheduleType: tplScheduleType, scheduleConfig: tplScheduleConfig, priority: tplPriority
        }))
        if (!res.ok) { toast('Gagal memperbarui template', 'error'); fetchTemplates(); return }
      } else {
        res = await api('/api/templates', jsonOpts('POST', {
          name: tplName, description: tplDesc, link: tplLink,
          scheduleType: tplScheduleType, scheduleConfig: tplScheduleConfig, priority: tplPriority
        }))
        if (!res.ok) { toast('Gagal menambahkan template', 'error'); fetchTemplates(); return }
      }
      fetchTemplates()
    } catch { toast('Gagal menyimpan template', 'error'); fetchTemplates() }
  }

  const deleteTemplate = (id: string) => {
    setConfirmData({
      title: 'Hapus Template', message: 'Yakin hapus template ini?',
      onConfirm: async () => {
        // Close dialog FIRST
        setConfirmData(null)
        // Optimistic: remove template locally immediately
        setTemplates(prev => prev.filter(t => t.id !== id))
        toast('Template dihapus!', 'success')
        try { const res = await api(`/api/templates/${id}`, { method: 'DELETE' }); if (!res.ok) { toast('Gagal menghapus', 'error'); fetchTemplates(); return } fetchTemplates() }
        catch { toast('Gagal menghapus', 'error'); fetchTemplates() }
      }
    })
  }

  const openEditTemplate = (t: TaskTemplate) => {
    setFormTemplateName(t.name); setFormTemplateDesc(t.description || ''); setFormTemplateLink(t.link || '')
    setFormTemplateScheduleType(t.scheduleType)
    try { setFormTemplateScheduleConfig(JSON.parse(t.scheduleConfig)) } catch { setFormTemplateScheduleConfig({}) }
    setFormTemplatePriority(t.priority || 'medium')
    setEditingTemplate(t); setTemplateDialogOpen(true)
  }

  const loadFromTemplate = (t: TaskTemplate) => {
    setFormName(t.name); setFormDesc(t.description || ''); setFormLink(t.link || '')
    setFormScheduleType(t.scheduleType)
    try { setFormScheduleConfig(JSON.parse(t.scheduleConfig)) } catch { setFormScheduleConfig({}) }
    setFormPriority(t.priority || 'medium')
    toast('Template "' + t.name + '" dimuat!', 'info')
  }

  /* ===== Dialog focus trap ===== */
  const trapDialogFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const root = e.currentTarget
    const items = Array.from(root.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex]'))
      .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0)
    if (items.length === 0) { e.preventDefault(); return }
    const first = items[0], last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) { e.preventDefault(); last.focus() }
    } else if (active === last || !root.contains(active)) { e.preventDefault(); first.focus() }
  }

  // Setelah "simpan & tambah lagi" sukses, fieldset baru aktif lagi saat commit.
  // Fokus ke nama tugas berikutnya menunggu state itu, bukan menebak lewat rAF.
  useEffect(() => {
    if (dialogType === 'add' && savedTaskCount > 0 && !savingTask) {
      document.getElementById('task-name')?.focus()
    }
  }, [dialogType, savedTaskCount, savingTask])

  // Konfirmasi muncul di atas form tugas: fokus pindah ke tombol batal yang aman,
  // lalu kembali ke pemicu saat konfirmasi ditutup (draft tidak ikut hilang).
  useEffect(() => {
    if (!confirmData) return
    const previous = document.activeElement as HTMLElement | null
    confirmDialogRef.current?.querySelector<HTMLElement>('[data-confirm-cancel]')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [confirmData])

  /* ===== Keyboard shortcuts ===== */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const taskDialogOpen = dialogType === 'add' || dialogType === 'edit'
      // Konfirmasi teratas dulu: Escape membatalkan konfirmasi, bukan membuang
      // draft di belakangnya. Shortcut lain tidak boleh menembus dialog apa pun.
      if (confirmData) {
        if (e.key === 'Escape' && !confirmLoading) {
          // stopImmediatePropagation: React bisa memasang ulang listener saat
          // state berubah; jangan sampai Escape yang sama ikut menutup form.
          e.preventDefault(); e.stopImmediatePropagation(); setConfirmData(null)
        }
        return
      }
      if (taskDialogOpen) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); requestCloseTaskDialog(); return }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault(); e.stopImmediatePropagation(); saveTask(e.shiftKey && dialogType === 'add' ? 'again' : 'close')
        }
        return
      }
      if (dialogType || moveDialogTask) {
        if (e.key === 'Escape') { e.preventDefault(); closeAll() }
        return
      }
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur()
          // Jangan closeAll() jika user sedang menulis catatan (notes panel terbuka)
          if (!notesPanelOpen || tag !== 'TEXTAREA') closeAll()
        }
        return
      }
      switch (e.key) {
        case 'r': case 'R': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); fetchData(true) }; break
        case 'Escape': closeAll(); break
        case 'f': case 'F': case '/': e.preventDefault(); document.getElementById('search-input')?.focus(); break
        /* D = Dashboard, M = Monitor.
           Sebelumnya tombol D malah membuka Monitor (berlawanan dengan label
           di toolbar dan halaman Bantuan), jadi shortcut-nya tidak bisa dipercaya. */
        case 'd': case 'D': if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          setBulkSelected(new Set()); setSelectMode(false); setViewMode('dashboard'); setActiveTab('all'); setDashFilterQuery('')
        }; break
        case 'm': case 'M': if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          setBulkSelected(new Set()); setSelectMode(false); setViewMode('monitor'); setActiveTab('all')
        }; break
        /* Fix #14: N to add task */
        case 'n': case 'N': if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          openAdd(dashFilterProject && dashFilterProject !== '__no_project__' ? dashFilterProject : null)
        }; break
        /* T shortcut: add standalone task (tanpa project) */
        case 't': case 'T': if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          openAddStandalone()
        }; break
        /* Feature 6: Number keys for filter tabs (switch to Dashboard view) */
        case '1': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setBulkSelected(new Set()); setSelectMode(false); setViewMode('dashboard'); setActiveTab('all'); setDashFilterQuery('') }; break
        case '2': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setBulkSelected(new Set()); setSelectMode(false); setViewMode('dashboard'); setActiveTab('siap'); setDashFilterQuery('') }; break
        case '3': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setBulkSelected(new Set()); setSelectMode(false); setViewMode('dashboard'); setActiveTab('cooldown'); setDashFilterQuery('') }; break
        case '4': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setBulkSelected(new Set()); setSelectMode(false); setViewMode('dashboard'); setActiveTab('selesai'); setDashFilterQuery('') }; break

        /* Feature 6: ? open help */
        case '?': e.preventDefault(); setDialogType('help'); break
      }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [expandedProjects, projects, viewMode, dialogType, notesPanelOpen, confirmData, confirmLoading, moveDialogTask, selectedTaskId, dashFilterProject, authUser?.id, formName, formDesc, formLink, formScheduleType, formScheduleConfig, formProjectId, formPriority, savingTask])

  const closeAll = () => { setDialogType(null); setConfirmData(null); setContextMenu(null); setProjectContextMenu(null); setOpenMenu(null); setMoveDialogTask(null); cancelWorking(); setProfileMenuOpen(false); setEditingNoteId(null); setNoteFormContent(''); setBatchCompleting(null); setTemplateDialogOpen(false); setImportCode(''); setImportPreview(null); setShareCode(''); setShareTaskCount(0); setTelegramCode(''); setMoveTargetProjectId(null) }
  const toggleCollapse = (s: string) => setCollapsedSections(p => ({ ...p, [s]: !p[s] }))

  /* ===== Active tasks: hide completed 'sekali' from main view ===== */
  // In real life, a one-time task done is DONE - no reason to keep showing it.
  // It only appears in 'selesai' tab for reference.
  // getActiveTasks is now defined earlier (before useMemo) to avoid TDZ error

  /* ===== Fix #4: Filtered tasks includes project name matching ===== */
  const filterTasks = (pt: Task[], projectName: string) => {
    // When viewing 'selesai' tab, show ALL completed tasks including 'sekali'
    // Otherwise, hide completed 'sekali' from active view (they're archived)
    const base = activeTab === 'selesai' ? pt : getActiveTasks(pt)
    return base.filter(t => {
      if (activeTab !== 'all' && t.status !== activeTab) return false
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase()
        return t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q) || projectName.toLowerCase().includes(q)
      }
      return true
    })
  }

  /* ===== Render: Task Row ===== */

  const renderRow = (t: Task) => {
    const done = t.status === 'selesai', loading = completingIds.has(t.id)
    /* Fix #13: title attribute for description preview */
    const titleParts: string[] = []
    if (t.description) titleParts.push(t.description)
    if (t.notes) titleParts.push(`Catatan: ${t.notes}`)
    const titleAttr = titleParts.length > 0 ? titleParts.join('\n') : undefined

    return (
      <div key={t.id} className={`tree-task-row ${selectedTaskId === t.id ? 'selected' : ''}`} onClick={() => openDetail(t)} onContextMenu={e => handleCtx(e, t)} onTouchStart={e => handleTouchStart(e, t)} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}>
        {/* Leading status indicator: only checkbox for done tasks, nothing for siap/cooldown */}
        {t.status === 'selesai' ? (
          <input type="checkbox" className="task-checkbox" checked={done} style={{ opacity: loading ? 0.5 : 1 }}
            onClick={e => { e.stopPropagation(); if (loading) return; if (done) reset(t.id); else complete(t.id) }} readOnly aria-label={done ? `Uncheck ${t.name}` : `Complete ${t.name}`} />
        ) : null}
        {/* Feature 1: Priority dot */}
        <span className="priority-dot" style={{ background: priorityDot(t.priority) }} title={priorityLabel(t.priority)} />
        {t.pinned && <span className="task-pin">📌</span>}
        <span className="task-name" style={{ textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }} title={titleAttr}>
          {searchQuery ? <HL text={t.name} q={searchQuery} /> : t.name}
        </span>
        <span className="task-schedule-info">{scheduleLabel(t.scheduleType)}</span>
        {t.status === 'cooldown' && t.cooldownRemaining && (
          <span className="task-cd-timer" title={t.nextReadyAt ? `Siap: ${fmtTime(new Date(t.nextReadyAt))}` : ''}>
            {t.cooldownRemaining}
          </span>
        )}
        {done && <span className="task-schedule-info">✓</span>}
        {isSafeHttpUrl(t.link) && (
          <a
            className={`task-link-btn ${t.status === 'siap' && settings.autoCompleteLink ? 'auto-complete' : ''}`}
            href="#"
            title={t.status === 'siap' && settings.autoCompleteLink ? 'Klik: Buka link + Auto selesaikan' : 'Buka link'}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              if (settings.autoCompleteLink && t.status === 'siap') {
                completeAndOpenLink(t)
              } else {
                window.open(t.link!, '_blank', 'noopener,noreferrer')
              }
            }}
          >🔗</a>
        )}
        {/* Siap tasks: Kerjakan + Selesai buttons at the end */}
        {t.status === 'siap' && (
          <div className="task-action-btns">
            <button className="work-btn" onClick={e => { e.stopPropagation(); startWorking(t) }} title="Kerjakan (10d)" style={{ color: '#8B6914' }}>🔨 Kerjakan</button>
            <button className="work-btn" onClick={e => { e.stopPropagation(); complete(t.id) }} title="Selesai" style={{ color: 'var(--win95-siap)', opacity: completingIds.has(t.id) ? 0.5 : 1 }} disabled={completingIds.has(t.id)}>{completingIds.has(t.id) ? '⏳' : '✓'} Selesai</button>
          </div>
        )}
      </div>
    )
  }

  /* ===== Fix #6: Pinned tasks sort first in status groups ===== */
  /**
   * Empty message yang kontekstual. Dulu semua kondisi kosong menampilkan
   * "Tidak ditemukan" — padahal belum tentu user sedang mencari; bisa jadi
   * hanya karena filter status tidak punya isi. Pesan yang salah bikin user
   * mengira datanya hilang.
   */
  const emptyFilterText = () => {
    if (debouncedSearch.trim()) return `Tidak ada tugas yang cocok dengan "${debouncedSearch.trim()}"`
    if (activeTab === 'siap') return 'Belum ada tugas yang siap dikerjakan sekarang'
    if (activeTab === 'cooldown') return 'Tidak ada tugas yang sedang menunggu'
    if (activeTab === 'selesai') return 'Belum ada tugas yang selesai'
    return 'Tidak ada tugas yang sesuai dengan pilihan ini'
  }

  const renderStatusGroup = (title: string, list: Task[], key: string, color: string) => {
    if (activeTab !== 'all' && activeTab !== key) return null
    if (list.length === 0 && !debouncedSearch) return null
    // When searching and no matches, hide empty groups
    if (list.length === 0 && debouncedSearch) return null
    const col = collapsedSections[key]
    const sortedList = sortTasksByPriorityAndPin(list)
    return (
      <div className="tree-status-group">
        <div className="tree-status-header" onClick={() => toggleCollapse(key)}>
          <span className={`collapse-toggle ${col ? 'collapsed' : ''}`} style={{ color, fontSize: 10 }}>{title}</span>
          <span className="count-badge">{list.length}</span>
        </div>
        {!col && (
          <div className="tree-status-content">
            {sortedList.map(renderRow)}
          </div>
        )}
      </div>
    )
  }

  /* ===== Render: Project Folder ===== */
  /* ===== Render: Schedule Config (for task form and template form) ===== */
  const renderSchedCfg = (config: Record<string, unknown> = formScheduleConfig, setConfig: (k: string, v: unknown) => void = (k, v) => setFormScheduleConfig(p => ({ ...p, [k]: v })), schedType: string = formScheduleType) => {
    const uc = setConfig
    switch (schedType) {
      case 'harian': return <div className="schedule-config-area"><div className="win95-field"><label>Jeda setelah selesai (jam)</label><input type="number" aria-label="Jeda setelah selesai (jam)" className="win95-input" value={config.cooldownHours === undefined ? 24 : Number(config.cooldownHours)} min={1} max={168} onChange={e => uc('cooldownHours', +e.target.value)} /><div className="hint">Contoh: selesai pukul 15.00 dengan jeda 24 jam → siap besok pukul 15.00. Bukan reset tengah malam.</div></div></div>
      case 'mingguan': return <div className="schedule-config-area"><div className="win95-field"><label>Hari setiap minggu</label><select aria-label="Hari setiap minggu" className="win95-select" value={(config.dayOfWeek as number) ?? 0} onChange={e => uc('dayOfWeek', +e.target.value)}>{DAYS_ID.map((d, i) => <option key={i} value={i}>{d}</option>)}</select><div className="hint">Siap mulai pukul 00.00 pada hari yang dipilih dan tetap siap sampai dikerjakan. Maksimal sekali per minggu.</div></div></div>
      case 'jam_tertentu': return <div className="schedule-config-area"><div className="win95-field"><label>Jam mulai siap setiap hari</label><input type="text" aria-label="Jam mulai siap setiap hari" className="win95-input" placeholder="09:00, 21:00" value={Array.isArray(config.times) ? (config.times as string[]).join(',') : ''} onChange={e => uc('times', e.target.value.split(','))} /><div className="hint">Format 24 jam, pisahkan dengan koma. Contoh 00:00 untuk reset setiap tengah malam. Setelah jam tersebut, tugas tetap siap sampai selesai.</div></div></div>
      case 'tanggal_spesifik': return <div className="schedule-config-area"><div className="win95-field"><label>Mulai bisa dikerjakan pada tanggal</label><input type="date" aria-label="Mulai bisa dikerjakan pada tanggal" className="win95-input" value={Array.isArray(config.dates) ? String(config.dates[0] || '') : ''} onChange={e => uc('dates', e.target.value ? [e.target.value] : [])} /><div className="hint">Tugas satu kali, mulai siap pada 00.00 tanggal ini. Ini bukan batas akhir (deadline).</div></div></div>
      case 'kustom': return <div className="schedule-config-area"><div className="win95-field"><label>Berapa jam setelah selesai?</label><input type="number" aria-label="Jeda setelah selesai (jam)" className="win95-input" value={config.cooldownHours === undefined ? 24 : Number(config.cooldownHours)} min={1} max={8760} onChange={e => uc('cooldownHours', +e.target.value)} /><div className="hint">Contoh: 24 jam berarti siap lagi 24 jam setelah Anda menekan Selesai.</div></div></div>
      default: return <div className="schedule-config-area"><div className="hint">Dikerjakan sekali; setelah selesai tidak akan muncul lagi sebagai tugas aktif.</div></div>
    }
  }

  /* ===== Render: Daftar Task (v3 — sidebar project + baris dua tingkat) ===== */
  /**
   * Ditata ulang karena versi lama menyaring tiga kali berturut-turut (tab
   * status → dropdown project → folder project → grup status di dalam folder).
   * Sekarang: project ada di sidebar, tab status di atas, dan tiap task satu
   * baris dengan aksi yang jelas. Logika filter tetap fungsi yang sama
   * (`getActiveTasks`, `sortTasksByPriorityAndPin`) supaya perilaku data tidak
   * berubah — hanya tampilannya.
   */
  const listPool = dashFilterProject
    ? (dashFilterProject === '__no_project__' ? tasks.filter(t => !t.project) : tasks.filter(t => t.project?.id === dashFilterProject))
    : tasks

  const searchMatch = (t: Task) => {
    const q = debouncedSearch.trim().toLowerCase()
    if (!q) return true
    return (
      t.name.toLowerCase().includes(q) ||
      !!t.description?.toLowerCase().includes(q) ||
      !!t.notes?.toLowerCase().includes(q) ||
      !!t.project?.name.toLowerCase().includes(q)
    )
  }

  // Daftar dan angka tab memanggil fungsi yang sama (tasksForTab/countForTab)
  // supaya tidak mungkin lagi berbeda — dulu di dalam proyek tab "Semua (3)"
  // padahal kartunya cuma 2 karena tugas sekali yang sudah selesai masih
  // dihitung tapi tidak ditampilkan.
  const visibleTasks = sortTasksByPriorityAndPin(tasksForTab(listPool, activeTab).filter(searchMatch))

  const countIn = (status: 'siap' | 'cooldown' | 'selesai') => countForTab(listPool, status, searchMatch)

  // Catatan: sengaja BUKAN useMemo — fungsi render ini dipanggil kondisional
  // (bergantung viewMode), jadi memakai hook di dalamnya melanggar aturan hooks
  // dan pernah membuat aplikasi berhenti di layar "Memuat data...".
  const countAll = countForTab(listPool, 'all', searchMatch)

  /** Satu baris task: nama + meta di kiri, status & aksi di kanan. */
  const renderTaskRow = (t: Task) => {
    const loading = completingIds.has(t.id)
    const whenText =
      t.status === 'siap' ? 'Siap' : t.status === 'cooldown' ? t.cooldownRemaining || '—' : 'Selesai'
    const whenClass = t.status === 'siap' ? 'siap' : t.status === 'cooldown' ? 'cd' : 'done'

    const titleParts: string[] = []
    if (t.description) titleParts.push(t.description)
    if (t.notes) titleParts.push(`Catatan: ${t.notes}`)

    return (
      <div
        key={t.id}
        className={`v3-row ${selectedTaskId === t.id || (selectMode && bulkSelected.has(t.id)) ? 'selected' : ''}`}
        data-status={t.status}
        onClick={() => { if (selectMode && viewMode !== 'monitor') toggleBulk(t.id); else openDetail(t) }}
        onContextMenu={e => handleCtx(e, t)}
        onTouchStart={e => handleTouchStart(e, t)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        title={titleParts.length ? titleParts.join('\n') : undefined}
      >
        <div className="v3-row-bar" />
        {selectMode && viewMode !== 'monitor' && <input
          type="checkbox"
          className="v3-check"
          checked={bulkSelected.has(t.id)}
          onClick={e => e.stopPropagation()}
          onChange={() => toggleBulk(t.id)}
          aria-label={`Pilih ${t.name}`}
          title="Pilih untuk aksi massal"
        />}
        <div className="v3-row-main">
          <div className="v3-row-name">
            {t.pinned && <span title="Disematkan">📌</span>}
            <span style={{ background: priorityDot(t.priority), width: 8, height: 8, display: 'inline-block', border: '1px solid #606060', flex: '0 0 8px' }} title={priorityLabel(t.priority)} />
            <button type="button" className="v3-task-name-button" aria-label={`${selectMode && viewMode !== 'monitor' ? 'Pilih' : 'Lihat detail'} ${t.name}`} onClick={e => { e.stopPropagation(); if (selectMode && viewMode !== 'monitor') toggleBulk(t.id); else openDetail(t) }}>
              {searchQuery ? <HL text={t.name} q={searchQuery} /> : t.name}
            </button>
          </div>
          <div className="v3-row-meta">
            {t.project ? (
              <span className="v3-chip">
                <span className="v3-chip-dot" style={{ background: t.project.color }} />
                {t.project.name}
              </span>
            ) : (
              <span className="v3-chip">📎 Tanpa proyek</span>
            )}
            <span>{scheduleLabel(t.scheduleType)}</span>
            {(t.logCount ?? 0) > 0 && <span title="Sudah diselesaikan">· {t.logCount}× selesai</span>}
          </div>
        </div>

        <div className={`v3-row-when ${whenClass}`}>
          {t.status === 'siap' ? 'Siap sekarang' : whenText}
          {t.status === 'cooldown' && t.nextReadyAt && (
            <small>Siap {fmtFull(new Date(t.nextReadyAt))}</small>
          )}
        </div>

        <div className="v3-row-act" onClick={e => e.stopPropagation()}>
          {t.status === 'siap' && (
            <>
              {isSafeHttpUrl(t.link) && <button className="v3-btn" onClick={e => { e.stopPropagation(); if (settings.autoCompleteLink) completeAndOpenLink(t); else openTaskLink(t) }} title={settings.autoCompleteLink ? 'Buka link dan tandai selesai sesuai pengaturan' : 'Buka link tanpa menyelesaikan tugas'}>
                {settings.autoCompleteLink ? 'Buka + selesai' : 'Buka link ↗'}
              </button>}
              <button
                className="v3-btn v3-btn-primary"
                disabled={loading}
                title="Tandai selesai"
                onClick={e => { e.stopPropagation(); complete(t.id) }}
              >
                {loading ? '⏳' : '✓'} Selesai
              </button>
            </>
          )}
          {isSafeHttpUrl(t.link) && t.status !== 'siap' && (
            <a
              className="v3-btn v3-btn-icon"
              href="#"
              title="Buka link"
              style={{ textDecoration: 'none' }}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                window.open(t.link!, '_blank', 'noopener,noreferrer')
              }}
            >
              🔗
            </a>
          )}
        </div>
      </div>
    )
  }

  /**
   * Satu kartu tugas. Menggantikan baris tabel di daftar tugas: nama, status,
   * dan tombolnya berdekatan dalam satu kotak selebar tetap, bukan tersebar
   * dari ujung kiri ke ujung kanan layar. Handler aksi memakai fungsi yang
   * sama persis dengan baris lama — tidak ada perilaku baru.
   */
  const renderTaskCard = (t: Task) => {
    const loading = completingIds.has(t.id)
    const actions = taskCardActions(t, !!settings.autoCompleteLink)
    const statusText = taskCardStatusText(t)
    const isSelected = selectedTaskId === t.id || (selectMode && bulkSelected.has(t.id))
    const pick = () => { if (selectMode) toggleBulk(t.id); else openDetail(t) }

    const titleParts: string[] = []
    if (t.description) titleParts.push(t.description)
    if (t.notes) titleParts.push(`Catatan: ${t.notes}`)

    return (
      <article
        key={t.id}
        className={`v3-task-card${isSelected ? ' selected' : ''}`}
        data-status={t.status}
        onClick={pick}
        onContextMenu={e => handleCtx(e, t)}
        onTouchStart={e => handleTouchStart(e, t)}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        title={titleParts.length ? titleParts.join('\n') : undefined}
      >
        <div className="v3-task-card-head">
          {selectMode && (
            <input
              type="checkbox"
              className="v3-check v3-card-check"
              checked={bulkSelected.has(t.id)}
              onClick={e => e.stopPropagation()}
              onChange={() => toggleBulk(t.id)}
              aria-label={`Pilih ${t.name}`}
            />
          )}
          <span className="v3-card-prio" style={{ background: priorityDot(t.priority) }} title={priorityLabel(t.priority)} />
          <h3 className="v3-task-card-name">
            <button
              type="button"
              className="v3-task-name-button"
              aria-label={`${selectMode ? 'Pilih' : 'Lihat detail'} ${t.name}`}
              onClick={e => { e.stopPropagation(); pick() }}
            >
              {t.pinned && <span title="Disematkan">📌 </span>}
              {searchQuery ? <HL text={t.name} q={searchQuery} /> : t.name}
            </button>
          </h3>
        </div>

        <div className="v3-task-card-meta">
          {showProjectOnCard(dashFilterProject) && (
            t.project ? (
              <span className="v3-chip">
                <span className="v3-chip-dot" style={{ background: t.project.color }} />
                {t.project.name}
              </span>
            ) : <span className="v3-chip">📎 Tanpa proyek</span>
          )}
          <span>{scheduleLabel(t.scheduleType)}</span>
          {(t.logCount ?? 0) > 0 && <span>· {t.logCount}× selesai</span>}
        </div>

        <div className={`v3-task-card-status ${statusText.tone}`}>
          {t.status === 'cooldown' && `${cooldownIcon(t.cooldownMs)} `}{statusText.text}
          {t.status === 'cooldown' && t.nextReadyAt && <small>Siap {fmtFull(new Date(t.nextReadyAt))}</small>}
        </div>

        <div className="v3-task-card-act" onClick={e => e.stopPropagation()}>
          <div className="v3-task-card-act-main">
            {actions.primary === 'open-link' && (
              <button
                className="v3-btn v3-btn-primary v3-card-primary"
                onClick={() => { if (settings.autoCompleteLink) completeAndOpenLink(t); else openTaskLink(t) }}
                title={settings.autoCompleteLink ? 'Buka link dan tandai selesai sesuai pengaturan' : 'Buka link tanpa menyelesaikan tugas'}
              >
                {actions.primaryLabel}
              </button>
            )}
            {actions.primary === 'complete' && (
              <button className="v3-btn v3-btn-primary v3-card-primary" disabled={loading} title="Tandai selesai" onClick={() => complete(t.id)}>
                {loading ? '⏳ Menyimpan…' : actions.primaryLabel}
              </button>
            )}
            {actions.primary === 'detail' && (
              <button className="v3-btn v3-card-primary" onClick={() => openDetail(t)}>{actions.primaryLabel}</button>
            )}
            <button
              className="v3-btn v3-card-more"
              aria-haspopup="menu"
              aria-label={`Menu lain untuk ${t.name}`}
              title="Menu lain"
              onClick={e => handleCtx(e, t)}
            >
              ⋯
            </button>
          </div>

          {(actions.showComplete || actions.showLink || actions.showUndo) && (
            <div className="v3-task-card-act-row">
              {actions.showComplete && (
                <button className="v3-btn v3-card-secondary" disabled={loading} title="Tandai selesai" onClick={() => complete(t.id)}>
                  {loading ? '⏳ Menyimpan…' : '✓ Selesai'}
                </button>
              )}
              {actions.showLink && (
                <button className="v3-btn v3-card-secondary" title="Buka link tanpa menyelesaikan tugas" onClick={() => openTaskLink(t)}>
                  🔗 Buka link
                </button>
              )}
              {actions.showUndo && (
                <button className="v3-btn v3-card-secondary" title="Kembalikan tugas ini menjadi belum dikerjakan" onClick={() => undoLastComplete(t)}>
                  ↩ Batalkan selesai
                </button>
              )}
            </div>
          )}
        </div>
      </article>
    )
  }

  const renderDashboard = () => {
    const totalList = activeTasks.length

    return (
      <div className="v3-shell">
        {/* ── Sidebar: project ─────────────────────────────────────────── */}
        {projects.length > 0 && <aside className="v3-side" aria-label="Daftar proyek">
          <div className="v3-side-title">PROYEK</div>
          <button
            className={`v3-side-item ${dashFilterProject === null ? 'active' : ''}`}
            onClick={() => { clearBulk(); setDashFilterProject(null); setDashFilterQuery('') }}
          >
            <span className="v3-side-name">📋 Semua proyek</span>
            <span className="v3-side-count">{totalList}</span>
          </button>

          {sortedProjects.map(p => {
            const cnt = getActiveTasks(tasks.filter(t => t.project?.id === p.id)).length
            return (
              <button
                key={p.id}
                className={`v3-side-item ${dashFilterProject === p.id ? 'active' : ''}`}
                onClick={() => selectProjectFilter(p.id)}
                onContextMenu={e => handleProjCtx(e, p)}
                onTouchStart={e => handleProjTouchStart(e, p)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                title={`Tampilkan hanya ${p.name} — klik kanan untuk menu proyek`}
              >
                <span className="v3-side-swatch" style={{ background: p.color }} />
                <span className="v3-side-name">{p.name}</span>
                <span className="v3-side-count">{cnt}</span>
              </button>
            )
          })}

          {tasks.some(t => !t.project) && (
            <button
              className={`v3-side-item ${dashFilterProject === '__no_project__' ? 'active' : ''}`}
              onClick={() => { clearBulk(); setDashFilterProject('__no_project__'); setDashFilterQuery('') }}
            >
              <span className="v3-side-swatch" style={{ background: '#808080' }} />
              <span className="v3-side-name">Tanpa proyek</span>
              <span className="v3-side-count">{getActiveTasks(tasks.filter(t => !t.project)).length}</span>
            </button>
          )}

          <button className="v3-side-add" onClick={openAddProject} title="Buat project baru">+ Proyek baru</button>

          <div className="v3-side-sep" />
          <div className="v3-side-title">RINGKASAN</div>
          <div className="v3-side-stat"><span>Bisa dikerjakan</span><b style={{ color: 'var(--win95-siap)' }}>{totalSiap}</b></div>
          <div className="v3-side-stat"><span>Menunggu</span><b style={{ color: '#6b6b00' }}>{totalCd}</b></div>
          <div className="v3-side-stat"><span>Selesai</span><b>{totalDone}</b></div>
        </aside>}

        {/* ── Area utama ──────────────────────────────────────────────── */}
        <div className="v3-main">
          {tasks.length > 0 && <div className="v3-filterbar">
            <div className="v3-seg" role="group" aria-label="Filter status">
              <button aria-pressed={activeTab === 'all'} onClick={() => { clearBulk(); setActiveTab('all') }}>
                Semua <span className="v3-count">({countAll})</span>
              </button>
              <button aria-pressed={activeTab === 'siap'} onClick={() => { clearBulk(); setActiveTab('siap') }}>
                <span className="v3-tab-icon" aria-hidden="true">✓ </span>Siap <span className="v3-count">({countIn('siap')})</span>
              </button>
              <button aria-pressed={activeTab === 'cooldown'} onClick={() => { clearBulk(); setActiveTab('cooldown') }}>
                <span className="v3-tab-icon" aria-hidden="true">⏳ </span>Menunggu <span className="v3-count">({countIn('cooldown')})</span>
              </button>
              <button aria-pressed={activeTab === 'selesai'} onClick={() => { clearBulk(); setActiveTab('selesai') }}>
                <span className="v3-tab-icon" aria-hidden="true">✔ </span>Selesai <span className="v3-count">({countIn('selesai')})</span>
              </button>
            </div>
            <input
              type="text"
              className="v3-search"
              aria-label="Cari tugas"
              placeholder="Cari tugas… (F)"
              value={dashFilterQuery}
              onChange={e => { clearBulk(); setDashFilterQuery(e.target.value); setSearchQuery(e.target.value) }}
              id="search-input"
            />
            {/* dulu tombol ini punya baris sendiri setinggi 51px di HP — ruang
                yang lebih berguna untuk daftar tugas. Sekarang sejajar kolom cari. */}
            {!selectMode && visibleTasks.length > 0 && (
              <button className="v3-btn v3-select-toggle" onClick={() => { clearBulk(); setSelectMode(true) }}
                aria-label="Pilih beberapa tugas" title="Pilih beberapa tugas">
                ☑<span className="v3-select-toggle-text"> Pilih beberapa</span>
              </button>
            )}
            <span className="v3-listinfo">{visibleTasks.length} tugas</span>
          </div>}

          {selectMode ? (
            <div className="v3-bulkbar" role="region" aria-label="Tugas terpilih">
              <b>{bulkSelected.size} dipilih</b>
              <button className="v3-btn" onClick={() => setBulkSelected(new Set(visibleTasks.map(t => t.id)))} disabled={!visibleTasks.length || bulkBusy}>Pilih semua yang terlihat</button>
              <button className="v3-btn v3-btn-primary" disabled={bulkBusy || !bulkSelected.size} onClick={bulkComplete}>✓ Selesaikan pilihan</button>
              <button className="v3-btn" disabled={bulkBusy || !bulkSelected.size} onClick={bulkReset}>Hapus riwayat…</button>
              <button className="v3-btn" onClick={exitSelectMode} disabled={bulkBusy}>Batal memilih</button>
            </div>
          ) : null}

          {/* Konfirmasi sepulang mengerjakan: satu ketukan, tanpa mencari barisnya.
              Hanya muncul kalau tugasnya masih berstatus siap. */}
          {returnPromptOpen && (() => {
            const rt = tasks.find(t => t.id === returnTaskId)
            if (!rt || rt.status !== 'siap') return null
            return (
              <div className="return-bar" role="region" aria-label="Konfirmasi tugas selesai">
                <div className="return-bar-text">
                  Habis dibuka: <b>{rt.name}</b>
                  <span>Sudah selesai dikerjakan?</span>
                </div>
                <button type="button" className="v3-btn v3-btn-primary"
                  onClick={() => { setReturnPromptOpen(false); setReturnTaskId(null); returnTaskRef.current = null; complete(rt.id) }}>
                  ✓ Sudah selesai
                </button>
                <button type="button" className="v3-btn"
                  onClick={() => { setReturnPromptOpen(false); setReturnTaskId(null); returnTaskRef.current = null }}>
                  Belum
                </button>
              </div>
            )
          })()}

          {/* Judul kolom TUGAS/STATUS/AKSI dihapus: tiap kartu sudah berdiri
              sendiri, jadi header tabel hanya menambah baris tanpa informasi.
              "Pilih semua yang terlihat" tetap ada di bar aksi massal. */}

          <div className="v3-list">
            {tasks.length === 0 ? (
              <div className="v3-empty">
                <span className="v3-empty-icon">📋</span>
                <div className="first-task-title">{addToolbarProject ? `Mulai isi proyek "${addToolbarProject.name}"` : 'Mulai dengan tugas pertama'}</div>
                <button className="v3-btn v3-btn-primary first-task-button" onClick={openAddForCurrentFilter}>+ Tambah tugas</button>
              </div>
            ) : visibleTasks.length === 0 ? (
              <div className="v3-empty">
                <span className="v3-empty-icon">📭</span>
                <div>{activeTab === 'all' && !debouncedSearch.trim() && listPool.some(t => t.status === 'selesai') ? 'Tugas di sini sudah selesai. Lihat kembali di tab Selesai.' : emptyFilterText()}</div>
                {addToolbarProject && (
                  <button className="v3-btn v3-btn-primary" style={{ marginTop: 10 }} onClick={openAddForCurrentFilter}>+ Tambah tugas di {addToolbarProject.name}</button>
                )}
                {activeTab === 'all' && !debouncedSearch.trim() && listPool.some(t => t.status === 'selesai') && (
                  <button className="v3-btn" style={{ marginTop: 10 }} onClick={() => { clearBulk(); setActiveTab('selesai') }}>Lihat tugas selesai</button>
                )}
                {(dashFilterQuery || activeTab !== 'all' || dashFilterProject) && (
                  <button className="v3-btn" style={{ marginTop: 10 }} onClick={() => { clearBulk(); setDashFilterQuery(''); setSearchQuery(''); setActiveTab('all'); setDashFilterProject(null) }}>
                    Lihat semua tugas
                  </button>
                )}
              </div>
            ) : (
              <>
                {SECTIONS.map(sec => {
                  const items = visibleTasks.filter(t => t.status === sec.status)
                  const show = activeTab === sec.status || (activeTab === 'all' && items.length > 0)
                  if (!show || items.length === 0) return null
                  return (
                    <div key={sec.status}>
                      {activeTab === 'all' && (
                        <div className="v3-grouphead" data-status={sec.status}>
                          {sec.icon} {sec.label} ({items.length})
                        </div>
                      )}
                      <div className="v3-card-grid">{items.map(renderTaskCard)}</div>
                    </div>
                  )
                })}
              </>
            )}
            {/* Jalan menambah tugas ke proyek yang sedang dibuka. Sebelumnya
                hanya ada di toolbar (labelnya berubah jadi "+ Tugas di X") dan
                di menu klik-kanan/tekan-lama nama proyek — dua-duanya mudah
                terlewat, terutama di HP. */}
            {dashFilterProject && (
              <button className="v3-btn v3-add-in-project" onClick={openAddForCurrentFilter}>
                ＋ Tambah tugas di {dashFilterProject === NO_PROJECT_FILTER ? 'Tanpa proyek' : (addToolbarProject?.name ?? 'proyek ini')}
              </button>
            )}

            {/* Muncul hanya setelah pengguna punya tugas, dan hanya kalau belum
                ada pengingat yang aktif. Tidak muncul lagi setelah ditutup. */}
            {tasks.length > 0 && !reminderNudgeHidden && !telegramLinked && !pushEnabled && (
              <div className="reminder-nudge" role="region" aria-label="Ajakan menyalakan pengingat">
                <div className="reminder-nudge-text">
                  <b>Biar tidak lupa mengerjakan</b>
                  Nyalakan pengingat supaya kamu dikabari saat tugas siap lagi — termasuk ketika aplikasi ditutup.
                </div>
                <button type="button" className="v3-btn v3-btn-primary" onClick={openReminders}>
                  Nyalakan pengingat
                </button>
                <button type="button" className="v3-btn" onClick={dismissReminderNudge} aria-label="Tutup ajakan pengingat">
                  Nanti saja
                </button>
              </div>
            )}
            {tasks.length > 0 && <div className="v3-hint">Klik kartu untuk melihat detail · tombol ⋯ untuk menu lain</div>}
          </div>
        </div>
      </div>
    )
  }

  /* ===== Render: Monitor View ===== */
  /**
   * Monitor memakai `renderTaskRow` yang SAMA dengan daftar utama.
   * Sebelumnya keduanya punya penanda dan tombol sendiri (ikon kecil vs tombol
   * teks), sehingga satu perbaikan harus dikerjakan dua kali dan hasilnya bisa
   * berbeda. Sekarang bedanya cuma isi: kartu ringkasan + daftar yang sudah
   * difilter untukmu (siap sekarang / cooldown terdekat / terakhir selesai).
   */
  const renderMonitor = () => {
    // Progres ini komposisi tugas AKTIF. Tugas yang dikerjakan tidak tinggal di
    // situ: tugas sekali pindah ke arsip, tugas berulang pindah ke Menunggu.
    // Irisan "Selesai" karena itu selalu 0% dan hanya membingungkan sebelah
    // kartu "Selesai" yang menghitung riwayat — jadi irisannya dihapus.
    const pctCd = activeTasks.length > 0 ? Math.min(100, Math.round((totalCd / activeTasks.length) * 100)) : 0
    const pctSiap = activeTasks.length > 0 ? Math.min(100 - pctCd, Math.round((totalSiap / activeTasks.length) * 100)) : 0

    const readyNow = sortTasksByPriorityAndPin(activeTasks.filter(t => t.status === 'siap'))
    const soon = activeTasks.filter(t => t.status === 'cooldown').sort((a, b) => a.cooldownMs - b.cooldownMs).slice(0, 10)
    const recentDone = activeTasks
      .filter(t => t.status === 'selesai' && t.lastCompletedAt)
      .sort((a, b) => new Date(b.lastCompletedAt!).getTime() - new Date(a.lastCompletedAt!).getTime())
      .slice(0, 8)
    const projectProgress = sortedProjects
      .map(p => {
        const pt = tasks.filter(t => t.project?.id === p.id)
        const act = getActiveTasks(pt)
        return {
          ...p,
          total: act.length,
          siap: act.filter(t => t.status === 'siap').length,
          cd: act.filter(t => t.status === 'cooldown').length,
          done: act.filter(t => t.status === 'selesai').length,
        }
      })
      // Proyek kosong TETAP ditampilkan: di HP sidebar disembunyikan, jadi baris
      // ini satu-satunya jalan membuka proyek baru yang belum punya tugas.

    const cards: { key: string; label: string; value: number; color: string; tab: 'all' | 'siap' | 'cooldown' | 'selesai'; hint: string }[] = [
      { key: 'project', label: 'Project', value: projects.length, color: '#000080', tab: 'all', hint: 'Lihat semua task' },
      { key: 'aktif', label: 'Task aktif', value: activeTasks.length, color: '#000', tab: 'all', hint: 'Lihat semua task' },
      { key: 'siap', label: 'Siap dikerjakan', value: totalSiap, color: 'var(--win95-siap)', tab: 'siap', hint: 'Buka daftar siap' },
      { key: 'cd', label: 'Menunggu', value: totalCd, color: '#6b6b00', tab: 'cooldown', hint: 'Buka daftar menunggu' },
      { key: 'done', label: 'Selesai', value: totalDone, color: '#606060', tab: 'selesai', hint: 'Buka daftar selesai' },
    ]

    return (
      <>
        <div className="v3-cards">
          {cards.map(c => (
            <button
              key={c.key}
              className="v3-card"
              onClick={() => { setViewMode('dashboard'); setActiveTab(c.tab); exitSelectMode(); setDashFilterProject(null); setDashFilterQuery(''); setSearchQuery('') }}
              title={c.hint}
            >
              <span className="v3-card-value" style={{ color: c.color }}>{c.value}</span>
              <span className="v3-card-label">{c.label}</span>
            </button>
          ))}
        </div>

        <div className="v3-progress">
          <div className="v3-progress-bar">
            <div style={{ left: 0, width: `${pctSiap}%`, background: 'var(--win95-siap)' }} />
            <div style={{ left: `${pctSiap}%`, width: `${pctCd}%`, background: '#d4c34a' }} />
          </div>
          <div className="v3-progress-legend">
            <span><i style={{ background: 'var(--win95-siap)' }} /> Siap {pctSiap}%</span>
            <span><i style={{ background: '#d4c34a' }} /> Menunggu {pctCd}%</span>
          </div>
        </div>

        <fieldset className="win95-group">
          <legend>✅ Siap dikerjakan sekarang ({readyNow.length})</legend>
          {readyNow.length === 0
            ? <div className="v3-empty">Tidak ada task yang bisa dikerjakan sekarang. Semua masih menunggu atau sudah selesai.</div>
            : <div className="v3-list" style={{ maxHeight: 'none' }}>{readyNow.map(renderTaskRow)}</div>}
        </fieldset>

        {soon.length > 0 && (
          <fieldset className="win95-group">
            <legend>⏳ Segera siap ({soon.length})</legend>
            <div className="v3-list" style={{ maxHeight: 'none' }}>{soon.map(renderTaskRow)}</div>
          </fieldset>
        )}

        {projectProgress.length > 0 && (
          <fieldset className="win95-group">
            <legend>📂 Status per project ({projectProgress.length})</legend>
            <div style={{ padding: '4px 8px' }}>
              {projectProgress.map(p => {
                const s = p.total > 0 ? Math.round((p.siap / p.total) * 100) : 0
                const c = p.total > 0 ? Math.round((p.cd / p.total) * 100) : 0
                return (
                  <button type="button" key={p.id} className="v3-projrow"
                    onClick={() => { if (Date.now() - ctxOpenTimeRef.current < 300) return; setViewMode('dashboard'); setActiveTab('all'); exitSelectMode(); setDashFilterProject(p.id); setDashFilterQuery(''); setSearchQuery('') }}
                    onContextMenu={e => handleProjCtx(e, p)}
                    onTouchStart={e => handleProjTouchStart(e, p)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchEnd}
                    title={`Buka proyek ${p.name} — klik kanan / tekan lama untuk menu (tambah task, share)`}>
                    <span className="v3-side-swatch" style={{ background: p.color }} />
                    <span className="v3-projrow-name">{p.name}</span>
                    <span className="v3-progress-bar v3-progress-mini">
                      <span style={{ width: `${s}%`, background: 'var(--win95-siap)', position: 'absolute', left: 0, top: 0, bottom: 0 }} />
                      <span style={{ width: `${c}%`, background: '#d4c34a', position: 'absolute', left: `${s}%`, top: 0, bottom: 0 }} />
                    </span>
                    <span className="v3-projrow-meta">{p.siap} siap · {p.cd} menunggu · {p.done} selesai</span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        )}

        {recentDone.length > 0 && (
          <fieldset className="win95-group">
            <legend>✔️ Terakhir selesai ({recentDone.length})</legend>
            <div className="v3-list" style={{ maxHeight: 'none' }}>{recentDone.map(renderTaskRow)}</div>
          </fieldset>
        )}
      </>
    )
  }

  /* ===== LOGIN / REGISTER SCREEN ===== */
  if (!authenticated && !loading) return (
    <div className="mbg-desktop">
      <div className="win95-window" style={{ maxWidth: 'min(380px, 95vw)', margin: '80px auto 0' }}>
        <div className="win95-titlebar"><span className="win95-titlebar-text">MBG - Airdrop Task Manager</span></div>
        <div className="win95-content" style={{ padding: 16 }}>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 'bold' }}>MBG Task Manager</div>
            <div style={{ fontSize: 10, color: '#808080' }}>Kelola airdrop task dengan mudah</div>
          </div>

          {/* Tab toggle */}
          <div style={{ display: 'flex', marginBottom: 12, borderBottom: '2px solid #808080' }}>
            <button
              className={`win95-btn`}
              style={{ flex: 1, borderRadius: '2px 2px 0 0', border: authMode === 'login' ? '2px inset #d4d0c8' : '2px solid #d4d0c8', borderBottom: authMode === 'login' ? '2px solid #c0c0c0' : 'none', background: authMode === 'login' ? '#c0c0c0' : '#d4d0c8', fontWeight: authMode === 'login' ? 'bold' : 'normal', fontSize: 11 }}
              onClick={() => { setAuthMode('login'); setAuthError('') }}
            >🔐 Masuk</button>
            <button
              className={`win95-btn`}
              style={{ flex: 1, borderRadius: '2px 2px 0 0', border: authMode === 'register' ? '2px inset #d4d0c8' : '2px solid #d4d0c8', borderBottom: authMode === 'register' ? '2px solid #c0c0c0' : 'none', background: authMode === 'register' ? '#c0c0c0' : '#d4d0c8', fontWeight: authMode === 'register' ? 'bold' : 'normal', fontSize: 11 }}
              onClick={() => { setAuthMode('register'); setAuthError('') }}
            >📝 Daftar</button>
          </div>

          {authError && <div style={{ background: '#FFCCCC', border: '1px solid #CC0000', padding: '4px 8px', marginBottom: 8, fontSize: 10, color: '#CC0000' }}>{authError}</div>}

          {authMode === 'login' ? (
            <form onSubmit={handleLogin}>
              <div className="win95-field"><label>Username</label><input type="text" className="win95-input" value={loginUsername} onChange={e => { setLoginUsername(e.target.value); setAuthError('') }} placeholder="Masukkan username" autoFocus autoComplete="username" /></div>
              <div className="win95-field"><label>Password</label><input type="password" className="win95-input" value={loginPassword} onChange={e => { setLoginPassword(e.target.value); setAuthError('') }} placeholder="Masukkan password" autoComplete="current-password" onKeyDown={e => { if (e.key === 'Enter') handleLogin(e as unknown as React.FormEvent) }} /></div>
              <button className="win95-btn primary" type="submit" disabled={authLoading} style={{ width: '100%', marginTop: 4, fontSize: 12, padding: '4px 0' }}>{authLoading ? 'Memproses...' : 'Masuk'}</button>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              {bootstrapMode && (
                <div style={{ background: '#FFFFCC', border: '1px solid #808000', padding: '6px 8px', marginBottom: 10, fontSize: 11, lineHeight: 1.5 }}>
                  <b>👋 Instalasi baru terdeteksi.</b><br />
                  Belum ada akun di sistem ini. Akun pertama yang kamu buat otomatis menjadi <b>admin</b> dan tidak perlu kode undangan.
                </div>
              )}
              {!bootstrapMode && (
                <div className="win95-field">
                  <label>Kode Undangan *</label>
                  <input type="text" className="win95-input" value={registerInviteCode} onChange={e => { setRegisterInviteCode(e.target.value.toUpperCase()); setAuthError('') }} placeholder="Contoh: MBGUSER01" style={{ textTransform: 'uppercase', letterSpacing: 2, fontWeight: 'bold' }} autoFocus autoComplete="off" />
                  <div className="hint">Belum punya kode? Minta ke admin yang mengundangmu.</div>
                </div>
              )}
              <div className="win95-field"><label>Username *</label><input type="text" className="win95-input" value={registerUsername} onChange={e => { setRegisterUsername(e.target.value); setAuthError('') }} placeholder="Minimal 3 karakter (huruf/angka/_)" autoComplete="username" autoFocus={bootstrapMode} /></div>
              <div className="win95-field"><label>Nama Tampilan</label><input type="text" className="win95-input" value={registerDisplayName} onChange={e => setRegisterDisplayName(e.target.value)} placeholder="Opsional, nama yang ditampilkan" /></div>
              <div className="win95-field"><label>Password *</label><input type="password" className="win95-input" value={registerPassword} onChange={e => { setRegisterPassword(e.target.value); setAuthError('') }} placeholder="Minimal 6 karakter" autoComplete="new-password" onKeyDown={e => { if (e.key === 'Enter') handleRegister(e as unknown as React.FormEvent) }} /></div>
              <button className="win95-btn primary" type="submit" disabled={authLoading} style={{ width: '100%', marginTop: 4, fontSize: 12, padding: '4px 0' }}>{authLoading ? 'Memproses...' : 'Daftar'}</button>
            </form>
          )}

          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 10, color: '#808080' }}>
            {authMode === 'login' ? 'Belum punya akun? ' : 'Sudah punya akun? '}
            <a href="#" style={{ color: '#0000FF' }} onClick={e => { e.preventDefault(); setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>
              {authMode === 'login' ? 'Daftar di sini' : 'Masuk di sini'}
            </a>
          </div>
        </div>
        <div className="win95-statusbar">
          <div className="win95-statusbar-section">MBG v1.0</div>
        </div>
      </div>
    </div>
  )

  /* ===== Fix #3: Loading screen with Win95 animation ===== */
  if (loading) return (
    <div className="mbg-desktop">
      <div className="win95-window">
        <div className="win95-titlebar"><span className="win95-titlebar-text">MBG - Airdrop Task Manager</span></div>
        <div className="win95-content loading-screen">
          <div className="loading-icon">
            <div className="loading-bracket">[</div>
            <div className="loading-bar-track">
              <div className="loading-bar-fill" />
            </div>
            <div className="loading-bracket">]</div>
          </div>
          <div className="loading-text">Memuat data...</div>
        </div>
      </div>
    </div>
  )

  // Active counts — already memoized above, just get addDialogProject here
  const addDialogProject = projects.find(p => p.id === formProjectId)
  // Proyek yang sedang difilter di dashboard — tombol toolbar "+ Tugas" dan
  // empty state memakainya supaya tugas baru langsung masuk ke proyek itu.
  const addToolbarProject = viewMode !== 'monitor' && dashFilterProject && dashFilterProject !== NO_PROJECT_FILTER
    ? projects.find(p => p.id === dashFilterProject) ?? null
    : null

  /* Fix #17: Check if all folders are empty under active filter */
  const hasAnyContent = sortedProjects.some(p => {
    const pt = tasks.filter(t => t.project?.id === p.id)
    return filterTasks(pt, p.name).length > 0
  })

  // Only show global empty state when a specific filter is active and no matches
  const showEmptyState = activeTab !== 'all' && !hasAnyContent && !debouncedSearch
  const filterLabel = activeTab === 'siap' ? 'siap' : activeTab === 'cooldown' ? 'cooldown' : activeTab === 'selesai' ? 'selesai' : ''

  return (
    <div className="mbg-desktop">
      {/* ===== GLOBAL LOADING BAR — thin animated bar at top of window ===== */}
      {globalLoading && <div className="global-loading-bar"><div className="global-loading-bar-fill" /></div>}
      {/* ===== MAIN WINDOW ===== */}
      <div className="win95-window app-shell">
        {/* Title Bar */}
        <div className="win95-titlebar">
          <span className="win95-titlebar-text">MBG - Airdrop Task Manager</span>
          <div style={{ display: 'flex', gap: 0, alignItems: 'center' }}>
            <button className="win95-titlebar-btn" onClick={() => { setNotesPanelOpen(!notesPanelOpen); if (!notesPanelOpen) fetchNotes() }} title="Catatan (Notepad)" aria-label="Catatan" style={{ marginRight: 0 }}>📝</button>
            <div style={{ position: 'relative', marginLeft: 4 }}>
              <button className="win95-titlebar-btn" onClick={e => { e.stopPropagation(); setProfileMenuOpen(!profileMenuOpen) }} title="Profil Akun" aria-label="Profil dan pengaturan akun" aria-haspopup="menu" aria-expanded={profileMenuOpen}>👤</button>
              {profileMenuOpen && (
                <>
                  {/* Invisible overlay: clicks here close the profile menu */}
                  <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setProfileMenuOpen(false)} onPointerDown={e => e.stopPropagation()} />
                  <div ref={profileDropRef} role="menu" className="win95-dropdown" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 9999, minWidth: 'min(180px, 70vw)' }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                    <div className="win95-dropdown-item win95-dropdown-info" style={{ cursor: 'default', opacity: 0.9, fontSize: 11, fontWeight: 'bold' }}>{authUser?.displayName || authUser?.username || 'User'}</div>
                    <div className="win95-dropdown-item win95-dropdown-info" style={{ cursor: 'default', opacity: 0.5, fontSize: 10 }}>@{authUser?.username} | {projects.length} project, {activeTasks.length} aktif{totalArchived > 0 ? ` (+${totalArchived} arsip)` : ''}</div>
                    {isAdmin && <div className="win95-dropdown-item win95-dropdown-info" style={{ cursor: 'default', opacity: 0.7, fontSize: 10 }}>👑 ADMIN</div>}
                    <div className="win95-dropdown-sep" />
                    <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setProfileMenuOpen(false); openSettings() }}>⚙️ Pengaturan</button>
                    <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setProfileMenuOpen(false); setDialogType('templates'); fetchTemplates() }}>📋 Template Task</button>
                    <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setProfileMenuOpen(false); setDialogType('help') }}>❓ Bantuan</button>
                    {isAdmin && (
                      <>
                        <div className="win95-dropdown-sep" />
                        <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setProfileMenuOpen(false); openAdminPanel() }} style={{ color: '#006600', fontWeight: 'bold' }}>👑 Panel Admin</button>
                      </>
                    )}
                    <div className="win95-dropdown-sep" />
                    <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); handleLogout() }} style={{ color: '#cc0000' }}>🚪 Logout</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Menu Bar */}
        <div className="win95-menubar">
          <button type="button" className="win95-menubar-item" aria-haspopup="menu" aria-expanded={openMenu === 'file'} onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === 'file' ? null : 'file') }}>
            File
            {openMenu === 'file' && (
              <div className="win95-dropdown" role="menu" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); openAddProject(); setOpenMenu(null) }}>📁 Buat Project Baru</button>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); openAddStandalone(); setOpenMenu(null) }}>📌 Buat Task Baru</button>
                <div className="win95-dropdown-sep" />
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); doExport(); setOpenMenu(null) }}>Export Backup</button>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); setOpenMenu(null) }}>Import Data</button>
                <div className="win95-dropdown-sep" />
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); openImportShare(); setOpenMenu(null) }}>🔗 Import Share Code</button>
              </div>
            )}
          </button>
          <button type="button" className="win95-menubar-item" aria-haspopup="menu" aria-expanded={openMenu === 'view'} onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === 'view' ? null : 'view') }}>
            Lihat
            {openMenu === 'view' && (
              <div className="win95-dropdown" role="menu" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); exitSelectMode(); setViewMode('dashboard'); setActiveTab('all'); setDashFilterQuery(''); setDashFilterProject(null); setOpenMenu(null) }}>📋 Daftar tugas</button>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); exitSelectMode(); setViewMode('monitor'); setOpenMenu(null) }}>📊 Monitor</button>
                <div className="win95-dropdown-sep" />
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); exitSelectMode(); setViewMode('dashboard'); setActiveTab('siap'); setOpenMenu(null) }}>✅ Siap sekarang</button>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); exitSelectMode(); setViewMode('dashboard'); setActiveTab('cooldown'); setOpenMenu(null) }}>⏳ Menunggu</button>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); exitSelectMode(); setViewMode('dashboard'); setActiveTab('selesai'); setOpenMenu(null) }}>✔️ Selesai</button>
              </div>
            )}
          </button>
          <button type="button" className="win95-menubar-item" aria-haspopup="menu" aria-expanded={openMenu === 'tools'} onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === 'tools' ? null : 'tools') }}>
            Alat
            {openMenu === 'tools' && (
              <div className="win95-dropdown" role="menu" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); openReminders(); setOpenMenu(null) }}>🔔 Pengingat</button>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setDialogType('telegram'); setOpenMenu(null) }}>Telegram</button>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); openSettings(); setOpenMenu(null) }}>Pengaturan</button>
                <button type="button" role="menuitem" className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setDialogType('templates'); fetchTemplates(); setOpenMenu(null) }}>📋 Template Task</button>
              </div>
            )}
          </button>
          <button type="button" className="win95-menubar-item menubar-help-button" onClick={e => { e.stopPropagation(); setDialogType('help'); setOpenMenu(null) }}>
            Bantuan
          </button>
        </div>

        {/* Toolbar: satu aksi utama (Task Baru) + tombol pendukung */}
        <div className="win95-toolbar" style={{ flexWrap: 'wrap', gap: 3 }}>
          <button
            className="win95-toolbar-btn"
            onClick={openAddForCurrentFilter}
            title={addToolbarProject ? `Tambah tugas ke proyek ${addToolbarProject.name} (N)` : 'Buat task baru (N)'}
            style={{ fontWeight: 'bold', color: '#005500', paddingLeft: 10, paddingRight: 10 }}
          >
            ＋ <span className="toolbar-add-label">{addToolbarProject ? `Tugas di ${addToolbarProject.name}` : 'Tugas Baru'}</span>
          </button>
          <button
            className="win95-toolbar-btn"
            aria-pressed={viewMode !== 'monitor'}
            style={{ border: viewMode !== 'monitor' ? '1px inset' : '1px solid transparent', background: viewMode !== 'monitor' ? '#d4d0c8' : undefined }}
            onClick={() => { exitSelectMode(); setViewMode('dashboard'); setDashFilterProject(null) }}
            title="Daftar task (1-4)"
          >
            📋 <span>Daftar</span>
          </button>
          <button
            className="win95-toolbar-btn"
            aria-pressed={viewMode === 'monitor'}
            style={{ border: viewMode === 'monitor' ? '1px inset' : '1px solid transparent', background: viewMode === 'monitor' ? '#d4d0c8' : undefined }}
            onClick={() => { exitSelectMode(); setViewMode('monitor') }}
            title="Monitor (M)"
          >
            📊 <span>Monitor</span>
          </button>
          <details className="toolbar-more">
            <summary className="win95-toolbar-btn">Lainnya ▾</summary>
            <div className="toolbar-more-menu">
              <button onClick={e => { e.currentTarget.closest('details')!.open = false; openAddProject() }}>📁 Buat proyek</button>
              <button onClick={e => { e.currentTarget.closest('details')!.open = false; fetchData(true) }}>🔄 Muat ulang</button>
              <button onClick={e => { e.currentTarget.closest('details')!.open = false; setDialogType('templates'); fetchTemplates() }}>📋 Template</button>
              <button onClick={e => { e.currentTarget.closest('details')!.open = false; openReminders() }}>🔔 Pengingat</button>
              <button onClick={e => { e.currentTarget.closest('details')!.open = false; setDialogType('telegram') }}>📱 Telegram</button>
              {/* Penyelamat data. Menubar disembunyikan di layar sentuh, jadi
                  tanpa tiga item ini Export/Import tidak bisa dijangkau dari HP
                  sama sekali. Wajib ada di menu yang tetap tampil. */}
              <div className="toolbar-more-sep" role="separator" />
              <button onClick={e => { e.currentTarget.closest('details')!.open = false; doExport() }}>💾 Export backup</button>
              <button onClick={e => { e.currentTarget.closest('details')!.open = false; fileInputRef.current?.click() }}>📥 Import data</button>
              <button onClick={e => { e.currentTarget.closest('details')!.open = false; openImportShare() }}>🔗 Import share code</button>
            </div>
          </details>
        </div>

        {/* ===== MAIN CONTENT ===== */}
        <div className="win95-content v3-content">
          {viewMode === 'monitor' ? <div className="v3-monitor">{renderMonitor()}</div> : renderDashboard()}
        </div>

        {/* Status bar */}
        <div className="win95-statusbar">
          <div className="win95-statusbar-section">{projects.length} proyek, {activeTasks.length} tugas aktif{totalArchived > 0 && <span style={{ color: '#808080' }}> (+{totalArchived} arsip)</span>}{searchQuery && <span style={{ color: '#000080' }}> | Cari...</span>}{globalLoading && <span className="syncing-indicator"> ⟳ sinkronisasi...</span>}</div>
          <span ref={clockRef} className="win95-statusbar-section fixed" title="Jam saat ini" data-fmt={settings.timeFormat || '24'} data-tz={userTzRef.current}>🕐 </span>
          {telegramLinked && <div className="win95-statusbar-section fixed" title="Telegram">📱</div>}
          <div className="win95-statusbar-section fixed">{settings.timezone || 'WIB'}</div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={doImport} />
      <input ref={fileInputProjectImportRef} type="file" accept=".json" style={{ display: 'none' }} onChange={doImportProject} />

      {/* ===== ADD PROJECT DIALOG ===== */}
      {dialogType === 'add-project' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">📁 Buat Project Baru</span><button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body">
              <div className="win95-field"><label>Nama Project *</label><input type="text" className="win95-input" value={formProjectName} onChange={e => setFormProjectName(e.target.value)} placeholder="Contoh: LayerZero" autoFocus onKeyDown={e => { if (e.key === 'Enter' && formProjectName.trim() && !savingProject) { const n = formProjectName.trim(), c = formProjectColor; setDialogType(null); addProject(n, c) } }} /></div>
              <div className="win95-field"><label>Warna</label>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {PROJECT_COLORS.map(c => (
                    <div key={c} onClick={() => setFormProjectColor(c)}
                      style={{ width: 28, height: 28, background: c, border: formProjectColor === c ? '2px solid #000' : '1px solid #808080', cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="win95-dialog-footer">
              <button className="win95-btn primary" disabled={!formProjectName.trim() || savingProject} onClick={() => { const n = formProjectName.trim(), c = formProjectColor; setDialogType(null); addProject(n, c) }}>
                Buat
              </button>
              <button className="win95-btn" onClick={() => setDialogType(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ADD/EDIT TASK DIALOG ===== */}
      {(dialogType === 'add' || dialogType === 'edit') && (
        <div className="win95-dialog-overlay" role="presentation" onClick={requestCloseTaskDialog}>
          <div ref={taskDialogRef} className="win95-dialog task-form-dialog" role="dialog" aria-modal="true" aria-busy={savingTask} inert={confirmData ? true : undefined} aria-label={dialogType === 'add' ? 'Tambah tugas' : 'Edit tugas'} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onKeyDown={trapDialogFocus}>
            <div className="win95-titlebar">
              <span className="win95-titlebar-text">{dialogType === 'add' ? 'Tambah tugas' : 'Edit tugas'}</span>
              <button className="win95-titlebar-btn" aria-label="Tutup" disabled={savingTask} onClick={requestCloseTaskDialog}>✕</button>
            </div>
            {dialogType === 'add' && savedTaskCount > 0 && (
              <div className="task-save-progress" role="status">✓ {savedTaskCount} tugas tersimpan. Lanjutkan tugas berikutnya{formProjectId && formProjectId !== NO_PROJECT_FILTER ? ' di proyek yang sama' : ''}.</div>
            )}
            {dialogType === 'add' && taskDefaultsRemembered && savedTaskCount === 0 && (
              <div className="task-defaults-hint">Jadwal dan prioritas terakhir dipakai lagi. Masih bisa diubah di bawah.</div>
            )}
            <fieldset className="win95-dialog-body task-form-fields" disabled={savingTask}>
              {dialogType === 'add' && addDialogProject && (
                <div className="task-target-project" role="note">
                  📁 Masuk ke proyek: <b>{addDialogProject.name}</b>
                </div>
              )}
              <div className="win95-field"><label htmlFor="task-name">Apa yang ingin dikerjakan? *</label><input id="task-name" type="text" required className="win95-input" value={formName} onChange={e => { setFormName(e.target.value); setTaskFormError('') }} placeholder="Contoh: Klaim faucet" autoFocus /></div>
              <div className="win95-field"><label htmlFor="task-schedule">Kapan tugas ini dikerjakan?</label>
                <select id="task-schedule" className="win95-select" aria-label="Jadwal tugas" value={formScheduleType} onChange={e => {
                  const type = e.target.value
                  setFormScheduleType(type)
                  setFormScheduleConfig(type === 'jam_tertentu' ? { times: ['00:00'] } : {})
                  setTaskFormError('')
                }}>
                  <option value="sekali">Sekali saja</option>
                  <option value="jam_tertentu">Setiap hari pada jam yang dipilih</option>
                  <option value="mingguan">Setiap minggu pada hari yang dipilih</option>
                  <option value="kustom">Berulang beberapa jam setelah selesai</option>
                  <option value="tanggal_spesifik">Sekali, mulai pada tanggal tertentu</option>
                  {formScheduleType === 'harian' && <option value="harian">Setelah jeda tertentu (jadwal lama)</option>}
                </select>
              </div>
              {formScheduleType === 'jam_tertentu' ? (
                <div className="schedule-config-area">
                  <div className="win95-field">
                    <label htmlFor="task-daily-time">Siap setiap hari pukul</label>
                    <input id="task-daily-time" type="time" className="win95-input" value={Array.isArray(formScheduleConfig.times) ? String(formScheduleConfig.times[0] || '').trim() : ''} onChange={e => {
                      const rest = Array.isArray(formScheduleConfig.times) ? formScheduleConfig.times.slice(1) : []
                      setFormScheduleConfig(p => ({ ...p, times: [e.target.value, ...rest] })); setTaskFormError('')
                    }} />
                    <div className="hint">Contoh: 00:00 (12:00 AM) berarti siap setiap hari mulai tengah malam.</div>
                  </div>
                  <details className="schedule-more" open={Array.isArray(formScheduleConfig.times) && formScheduleConfig.times.length > 1 || undefined}>
                    <summary>Butuh lebih dari satu jam per hari?</summary>
                    <label htmlFor="task-daily-times">Semua jam, dipisahkan koma</label>
                    <input id="task-daily-times" type="text" className="win95-input" value={Array.isArray(formScheduleConfig.times) ? (formScheduleConfig.times as string[]).join(',') : ''} onChange={e => { setFormScheduleConfig(p => ({ ...p, times: e.target.value.split(',') })); setTaskFormError('') }} placeholder="09:00, 21:00" />
                    <div className="hint">Contoh: 09:00, 21:00. Tugas siap lagi pada jam berikutnya setelah diselesaikan.</div>
                  </details>
                </div>
              ) : renderSchedCfg(formScheduleConfig, (k, v) => { setTaskFormError(''); setFormScheduleConfig(p => ({ ...p, [k]: v })) }, formScheduleType)}
              {formScheduleType !== 'sekali' && <div className="schedule-timezone">Waktu mengikuti zona <b>{settings.timezone || 'WIB'}</b> di Pengaturan.</div>}
              <div className="win95-field"><label htmlFor="task-link">Link untuk mengerjakan (opsional)</label><input id="task-link" type="url" className="win95-input" value={formLink} onChange={e => { setFormLink(e.target.value); setTaskFormError('') }} placeholder="https://..." /></div>
              <details className="task-more" open={dialogType === 'edit' || undefined}>
                <summary>Pengaturan tambahan</summary>
              <div className="win95-field">
                <label htmlFor="task-project">Proyek (opsional)</label>
                {/* Selalu bisa diganti — dulu proyek terkunci saat tambah dari
                    menu proyek, pengguna tidak bisa mengoreksi salah pilih. */}
                <select id="task-project" className="win95-select" value={formProjectId === NO_PROJECT_FILTER ? '' : (formProjectId || '')} onChange={e => setFormProjectId(e.target.value || null)}>
                  <option value="">Tanpa proyek</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
                <div className="win95-field"><label htmlFor="task-description">Deskripsi (opsional)</label><textarea id="task-description" className="win95-textarea" rows={2} value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Catatan tentang tugas ini…" /></div>
                <fieldset className="task-priority"><legend>Prioritas</legend>
                  <label><input type="radio" name="priority" value="high" checked={formPriority === 'high'} onChange={() => setFormPriority('high')} /> 🔴 Tinggi</label>
                  <label><input type="radio" name="priority" value="medium" checked={formPriority === 'medium'} onChange={() => setFormPriority('medium')} /> 🟡 Sedang</label>
                  <label><input type="radio" name="priority" value="low" checked={formPriority === 'low'} onChange={() => setFormPriority('low')} /> 🟢 Rendah</label>
                </fieldset>
              {dialogType === 'add' && templates.length > 0 && (
                <div className="win95-field"><label>Gunakan template (opsional)</label>
                  <select aria-label="Gunakan template" className="win95-select" value="" onChange={e => { if (e.target.value) { const tpl = templates.find(t => t.id === e.target.value); if (tpl) loadFromTemplate(tpl) } }}>
                    <option value="">Pilih template…</option>
                    {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name} ({SCHEDULE_LABELS[tpl.scheduleType] || tpl.scheduleType})</option>)}
                  </select>
                </div>
              )}
              </details>

            </fieldset>
            {taskFormError && <div className="task-form-error" role="alert">⚠ {taskFormError}</div>}
            {/* Tombol simpan mati saat nama kosong. Tanpa keterangan, pengguna baru
                tidak tahu apa yang kurang — jadi alasannya ditulis tepat di atas tombol. */}
            {!formName.trim() && !taskFormError && (
              <div className="form-hint-inline" data-kind="warn" id="task-name-hint" style={{ padding: '0 12px' }}>
                Isi dulu nama tugas di atas untuk melanjutkan.
              </div>
            )}
            <div className="win95-dialog-footer task-form-footer">
              {dialogType === 'add' && (
                <button className="win95-btn primary task-save-again" disabled={!formName.trim() || savingTask} onClick={() => saveTask('again')}
                  aria-describedby={!formName.trim() ? 'task-name-hint' : undefined}
                  title="Simpan tugas ini, lalu kosongkan nama/link untuk tugas berikutnya; jadwal dan proyek tetap">
                  {savingTask ? '⏳ Menyimpan...' : '＋ Simpan & tambah lagi'}
                </button>
              )}
              <button className={`win95-btn ${dialogType === 'edit' ? 'primary' : ''}`} disabled={!formName.trim() || savingTask} onClick={() => saveTask('close')}
                aria-describedby={!formName.trim() ? 'task-name-hint' : undefined}
                title={!formName.trim() ? 'Isi nama tugas dulu' : undefined}
                style={savingTask ? { opacity: 0.6, cursor: 'wait' } : {}}>{savingTask ? '⏳ Menyimpan...' : dialogType === 'add' ? 'Simpan & selesai' : 'Simpan perubahan'}</button>
              <button className="win95-btn" disabled={savingTask} onClick={requestCloseTaskDialog}>Batal</button>
              <div className="desktop-only-hint task-save-shortcut">Ctrl+Enter: simpan & selesai{dialogType === 'add' ? ' · Ctrl+Shift+Enter: simpan & tambah lagi' : ''}</div>
            </div>
          </div>
        </div>
      )}

      {/* ===== DETAIL DIALOG ===== */}
      {dialogType === 'detail' && detailRef.current && (
        <DetailDialog task={detailRef.current} onClose={() => { setDialogType(null); detailRef.current = null }}
          onEdit={() => { if (detailRef.current) openEdit(detailRef.current) }}
          onComplete={() => { if (detailRef.current) { complete(detailRef.current.id); setDialogType(null) } }}
          onReset={() => { if (detailRef.current) { reset(detailRef.current.id); setDialogType(null) } }}
          onUndoComplete={() => { if (detailRef.current) { void undoLastComplete(detailRef.current); setDialogType(null) } }}
          onDelete={() => { if (detailRef.current) { delTask(detailRef.current.id); setDialogType(null) } }}
          onTogglePin={() => { if (detailRef.current) { togglePin(detailRef.current); detailRef.current = { ...detailRef.current, pinned: !detailRef.current.pinned } } }}
          onSaveNotes={saveNotes} noteDraft={noteDraftsRef.current[detailRef.current.id]} scheduleLabels={SCHEDULE_LABELS} autoCompleteLink={settings.autoCompleteLink}
          fmtTime={fmtTime} fmtFull={fmtFull} />
      )}

      {/* ===== SETTINGS DIALOG ===== */}
      {dialogType === 'settings' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">Pengaturan</span><button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body">
              <div className="win95-field"><label>Timezone</label><select className="win95-select" value={formTimezone} onChange={e => setFormTimezone(e.target.value)}>{TZ_OPTIONS.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}</select></div>
              <div className="win95-field"><label>Format Jam</label><select className="win95-select" value={formTimeFormat} onChange={e => setFormTimeFormat(e.target.value as '24' | '12')}><option value="24">24 Jam (14:30)</option><option value="12">12 Jam (02:30 PM)</option></select></div>
              <fieldset className="win95-group"><legend>Perilaku</legend>
                <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                    <input type="checkbox" className="task-checkbox" checked={formAutoCompleteLink} onChange={e => setFormAutoCompleteLink(e.target.checked)} />
                    <span><b>Auto-selesaikan</b> saat klik link</span>
                  </label>
                  <div style={{ fontSize: 10, color: '#808080', marginLeft: 20 }}>Task otomatis ditandai selesai saat link diklik (hanya task status Siap)</div>
                </div>
              </fieldset>
              <fieldset className="win95-group"><legend>Notifikasi</legend>
                <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" className="task-checkbox" checked={formTelegramNotif} onChange={e => setFormTelegramNotif(e.target.checked)} />
                    <span><b>Telegram</b> notifikasi</span>
                  </label>
                  <div style={{ fontSize: 10, color: '#808080', marginLeft: 20 }}>Kirim notifikasi sesuai waktu yang diatur di bawah & saat tugas siap</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                    <input type="checkbox" className="task-checkbox" checked={formBrowserNotif} onChange={e => { setFormBrowserNotif(e.target.checked); if (e.target.checked) requestNotifPermission() }} />
                    <span><b>🔔 Push Notifikasi</b> (seperti Discord)</span>
                  </label>
                  <div style={{ fontSize: 10, color: '#808080', marginLeft: 20 }}>Notif muncul di pojok kanan bawah walau app sedang dibuka app lain</div>
                  {notifPermission !== 'granted' && formBrowserNotif && (
                    <div style={{ fontSize: 11, color: '#7a3d00', marginLeft: 20, marginTop: 4, lineHeight: 1.5 }}>
                      Centang di atas baru menyimpan pilihan — push belum aktif.
                      <button type="button" className="win95-btn" style={{ display: 'block', marginTop: 6, minHeight: 36 }}
                        onClick={openReminders}>
                        Aktifkan sekarang
                      </button>
                    </div>
                  )}
                  {notifPermission === 'granted' && (
                    <div style={{ fontSize: 10, color: '#008000', marginLeft: 20, marginTop: 2 }}>
                      {pushEnabled ? '✅ Push aktif — notif akan muncul walau app ditutup' :
                        pushSupported ? '⏳ Mendaftarkan push notification...' :
                        '⚠️ Browser tidak mendukung push. Gunakan Chrome/Edge.'}
                    </div>
                  )}
                  {/* Feature 5: Audio alert toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                    <input type="checkbox" className="task-checkbox" checked={formAudioAlertEnabled} onChange={e => setFormAudioAlertEnabled(e.target.checked)} />
                    <span><b>🔊 Suara</b> peringatan</span>
                  </label>
                  <div style={{ fontSize: 10, color: '#808080', marginLeft: 20 }}>Bunyi beep saat task hampir siap / siap</div>
                </div>
              </fieldset>
              {/* Notification timing: how many minutes before cooldown ends */}
              <fieldset className="win95-group"><legend>🔔 Timing Notifikasi Cooldown</legend>
                <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.8 }}>
                  <div className="win95-field" style={{ marginBottom: 4 }}>
                    <label>Notif sebelum cooldown selesai</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="range" min={1} max={30} step={1} value={formNotifyBeforeMin} onChange={e => setFormNotifyBeforeMin(+e.target.value)} style={{ flex: 1 }} />
                      <span style={{ fontWeight: 'bold', minWidth: 36, textAlign: 'center' }}>{formNotifyBeforeMin} mnt</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#808080', marginTop: 2 }}>Notifikasi Windows/browser muncul {formNotifyBeforeMin} menit sebelum task siap (default: 5)</div>
                  </div>
                </div>
              </fieldset>
              <fieldset className="win95-group"><legend>Info</legend><div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.6 }}>
                <div>{projects.length} project, {activeTasks.length} aktif (Siap: {totalSiap} | Cooldown: {totalCd} | Selesai: {totalDone}){totalArchived > 0 && <span> | Arsip: {totalArchived}</span>}</div>
                <div>Telegram: {telegramLinked ? `Terhubung (${telegramName})` : 'Belum'}</div>
              </div></fieldset>
              <fieldset className="win95-group"><legend>Shortcuts</legend><div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.6 }}>
                <div><b>R</b> Refresh | <b>F</b> Cari | <b>N</b> Tambah task | <b>D</b> Dashboard | <b>M</b> Monitor | <b>Esc</b> Tutup</div>
                <div><b>1-4</b> Tab Filter | <b>?</b> Bantuan | <b>Ctrl+Enter</b> Simpan & selesai | <b>Ctrl+Shift+Enter</b> Simpan & tambah lagi</div>
              </div></fieldset>
            </div>
            <div className="win95-dialog-footer"><button className="win95-btn primary" onClick={saveSettings}>OK</button><button className="win95-btn" onClick={() => setDialogType(null)}>Batal</button></div>
          </div>
        </div>
      )}

      {/* ===== EDIT PROJECT DIALOG ===== */}
      {dialogType === 'edit-project' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">Edit Project</span><button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body">
              <div className="win95-field"><label>Nama Project</label><input type="text" className="win95-input" value={formProjectName} onChange={e => setFormProjectName(e.target.value)} /></div>
              <div className="win95-field"><label>Warna</label>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {PROJECT_COLORS.map(c => (
                    <div key={c} onClick={() => setFormProjectColor(c)}
                      style={{ width: 24, height: 24, background: c, border: formProjectColor === c ? '2px solid #000' : '1px solid #808080', cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="win95-dialog-footer">
              <button className="win95-btn primary" onClick={() => { if (selectedTaskId) editProject(selectedTaskId, formProjectName, formProjectColor) }}>OK</button>
              <button className="win95-btn" onClick={() => setDialogType(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TELEGRAM DIALOG ===== */}
      {/* ===== PENGINGAT: satu layar, dua pilihan jelas =====
          Bukan daftar checkbox di tengah Pengaturan. Setiap kartu menjelaskan
          apa yang didapat dan punya satu tombol aksi. */}
      {dialogType === 'reminders' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog reminder-dialog" role="dialog" aria-modal="true" aria-labelledby="reminder-title" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar">
              <span className="win95-titlebar-text" id="reminder-title">Pengingat</span>
              <button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setDialogType(null)}>✕</button>
            </div>
            <div className="win95-dialog-body">
              <p className="reminder-intro">
                Pilih cara kamu ingin dikabari saat tugas siap dikerjakan. Cukup salah satu.
              </p>

              {/* --- Jalur 1: notifikasi perangkat --- */}
              <div className="reminder-option" data-active={pushStatus === 'active'}>
                <div className="reminder-option-head">
                  <b>Notifikasi di perangkat ini</b>
                  {pushStatus === 'active' && <span className="reminder-badge">Aktif</span>}
                </div>
                <div className="reminder-option-desc">
                  Muncul di HP atau komputer ini, termasuk saat aplikasi ditutup.
                </div>
                {pushStatus === 'active' ? (
                  <div className="reminder-done">✅ Sudah aktif. Kamu akan dikabari otomatis.</div>
                ) : pushStatus === 'blocked' ? (
                  <div className="reminder-warn">
                    Izin notifikasi sedang diblokir browser. Buka ikon gembok di samping alamat situs,
                    ubah Notifikasi menjadi <b>Izinkan</b>, lalu muat ulang halaman ini.
                  </div>
                ) : pushStatus === 'unsupported' ? (
                  <div className="reminder-warn">Browser ini belum mendukung. Coba Chrome atau Edge, atau pakai Telegram di bawah.</div>
                ) : pushStatus === 'setup-failed' ? (
                  <div className="reminder-warn">
                    Notifikasi gagal disiapkan di perangkat ini. Coba muat ulang halaman.
                    Kalau masih gagal, pakai Telegram di bawah — itu tidak bergantung ke sini.
                  </div>
                ) : pushStatus === 'no-key' ? (
                  <div className="reminder-warn">
                    Server belum dikonfigurasi untuk push, jadi notifikasi perangkat
                    belum bisa dipakai di sini. Pakai Telegram di bawah — itu tetap jalan.
                    {notifPermission === 'granted' && ' Izin di perangkatmu sudah beres; tinggal servernya.'}
                  </div>
                ) : (
                  <button type="button" className="win95-btn primary reminder-action" onClick={enablePushReminder}>
                    Izinkan notifikasi
                  </button>
                )}
              </div>

              {/* --- Jalur 2: Telegram --- */}
              <div className="reminder-option" data-active={telegramLinked}>
                <div className="reminder-option-head">
                  <b>Lewat Telegram</b>
                  {telegramLinked && <span className="reminder-badge">Aktif</span>}
                </div>
                <div className="reminder-option-desc">
                  Dikirim ke chat Telegram kamu. Tetap masuk walau ganti perangkat.
                </div>
                {telegramLinked ? (
                  <div className="reminder-done">
                    ✅ Terhubung{telegramName ? ` ke ${telegramName}` : ''}.{' '}
                    <button type="button" className="win95-btn reminder-inline-btn" onClick={testTelegram} disabled={telegramTesting}>
                      {telegramTesting ? 'Mengirim…' : 'Kirim tes'}
                    </button>
                  </div>
                ) : telegramCode ? (
                  <div className="reminder-steps">
                    <div>Buka bot lalu tekan <b>Start</b>. Kode sudah terisi otomatis.</div>
                    {telegramBotUsername ? (
                      <a className="win95-btn primary reminder-action" href={`https://t.me/${telegramBotUsername.replace('@', '')}?start=${encodeURIComponent(telegramCode)}`} target="_blank" rel="noopener noreferrer">
                        Buka Telegram
                      </a>
                    ) : (
                      <div className="reminder-warn">
                        Nama bot belum diatur. Minta admin mengisinya, atau pakai notifikasi perangkat di atas.
                      </div>
                    )}
                    <div className="reminder-code">
                      Kalau diminta manual, kirim: <code>/start {telegramCode}</code>
                    </div>
                    <button type="button" className="win95-btn reminder-inline-btn" onClick={() => { setTelegramCode(''); fetchData() }}>
                      Saya sudah tekan Start
                    </button>
                  </div>
                ) : (
                  <button type="button" className="win95-btn primary reminder-action" onClick={genCode} disabled={codeGenerating}>
                    {codeGenerating ? 'Menyiapkan…' : 'Hubungkan Telegram'}
                  </button>
                )}
              </div>

              <div className="reminder-foot">
                Pilihan lanjutan (waktu pengingat, suara) ada di <b>Alat → Pengaturan</b>.
              </div>
            </div>
            <div className="win95-dialog-footer">
              <button className="win95-btn primary" onClick={() => setDialogType(null)}>Selesai</button>
            </div>
          </div>
        </div>
      )}

      {dialogType === 'telegram' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} style={{ maxWidth: 'min(420px, 95vw)' }}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">📱 Telegram</span><button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body">
              {/* Connection Status */}
              <fieldset className="win95-group">
                <legend>Status Koneksi</legend>
                <div style={{ padding: '6px 8px' }}>
                  {telegramLinked ? (
                    <div style={{ fontSize: 11 }}>
                      <div style={{ fontWeight: 'bold', color: '#008000' }}>✅ Terhubung</div>
                      <div>Akun: {telegramName || '?'}</div>
                      <button className="win95-btn" style={{ marginTop: 6 }} onClick={testTelegram} disabled={telegramTesting}>{telegramTesting ? '⏳ Mengirim...' : '🔔 Test Notifikasi'}</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#cc0000', fontWeight: 'bold' }}>❌ Belum terhubung</div>
                  )}
                </div>
              </fieldset>

              {/* Bot Username */}
              <fieldset className="win95-group">
                <legend>Bot Telegram</legend>
                <div style={{ padding: '6px 8px' }}>
                  <div className="win95-field">
                    <label>Username Bot</label>
                    <input type="text" className="win95-input" placeholder="@your_bot_username" value={telegramBotUsername} onChange={e => setTelegramBotUsername(e.target.value)} />
                    <div style={{ fontSize: 10, color: '#808080', marginTop: 2 }}>Username bot Telegram Anda (tanpa @)</div>
                  </div>
                  <button className="win95-btn" style={{ marginTop: 4 }} onClick={saveTelegramBotUsername}>💾 Simpan</button>
                </div>
              </fieldset>

              {/* Link/Re-link */}
              {!telegramLinked && (
                <fieldset className="win95-group">
                  <legend>Hubungkan Akun</legend>
                  <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.6 }}>
                    <b>Cara hubungkan:</b>
                    <ol style={{ paddingLeft: 16, marginTop: 4 }}>
                      <li>Klik "Generate Kode" di bawah</li>
                      <li>Chat {telegramBotUsername ? `@${telegramBotUsername.replace('@', '')}` : '@MBGBot'} di Telegram</li>
                      <li>Kirim <code>/start {'<kode>'}</code></li>
                    </ol>
                    <button className="win95-btn primary" onClick={genCode} disabled={codeGenerating} style={{ marginTop: 6 }}>{codeGenerating ? '...' : 'Generate Kode'}</button>
                    {telegramCode && (
                      <div style={{ padding: 8, background: '#fff', border: '2px inset', textAlign: 'center', marginTop: 8 }}>
                        <div style={{ fontSize: 10, color: '#808080' }}>Kode (15 menit):</div>
                        <div style={{ fontSize: 24, fontWeight: 'bold', fontFamily: 'monospace', letterSpacing: 4, color: '#000080' }}>{telegramCode}</div>
                        <div style={{ fontSize: 10, color: '#808080', marginTop: 4 }}>Kirim ke bot: /start {telegramCode}</div>
                      </div>
                    )}
                  </div>
                </fieldset>
              )}

              {telegramLinked && (
                <fieldset className="win95-group">
                  <legend>Instruksi</legend>
                  <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.6 }}>
                    <div>1. Chat {telegramBotUsername ? `@${telegramBotUsername.replace('@', '')}` : '@MBGBot'} di Telegram</div>
                    <div>2. Kirim <code>/status</code></div>
                    <div>3. Klik "🔔 Test Notifikasi" di atas</div>
                    <div style={{ marginTop: 4, color: '#808080' }}>Kirim <code>/status</code> ke bot untuk melihat ringkasan task</div>
                  </div>
                </fieldset>
              )}

              {/* Disconnect button */}
              {telegramLinked && (
                <div style={{ marginTop: 6, textAlign: 'center' }}>
                  <button className="win95-btn" style={{ color: '#cc0000' }} onClick={() => {
                    setConfirmData({
                      title: 'Disconnect Telegram',
                      message: 'Putuskan koneksi Telegram?',
                      onConfirm: async () => {
                        try {
                          await api('/api/settings', jsonOpts('PUT', { telegramChatId: null, telegramId: null, telegramName: null }))
                          setTelegramLinked(false)
                          setTelegramName('')
                          toast('Telegram diputuskan', 'info')
                          fetchData()
                        } catch { toast('Gagal', 'error') }
                        setConfirmData(null)
                      }
                    })
                  }}>Disconnect Telegram</button>
                </div>
              )}
            </div>
            <div className="win95-dialog-footer"><button className="win95-btn" onClick={() => setDialogType(null)}>Tutup</button></div>
          </div>
        </div>
      )}

      {/* ===== Fix #9: MOVE TASK DIALOG ===== */}
      {moveDialogTask && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setMoveDialogTask(null)}>
          <div className="win95-dialog move-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">📦 Pindah Task</span><button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setMoveDialogTask(null)}>✕</button></div>
            <div className="win95-dialog-body">
              <div style={{ fontSize: 11, marginBottom: 8 }}>
                <b>{moveDialogTask.name}</b> pindah ke project:
              </div>
              <div className="win95-field">
                <label>Target Project</label>
                <select className="win95-select" value={moveTargetProjectId || ''} onChange={e => setMoveTargetProjectId(e.target.value || null)}>
                  <option value="">-- Pilih Project --</option>
                  {projects.filter(p => p.id !== moveDialogTask.project?.id).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="win95-dialog-footer">
              <button className="win95-btn primary" onClick={confirmMoveTask} disabled={!moveTargetProjectId}>Pindah</button>
              <button className="win95-btn" onClick={() => setMoveDialogTask(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== CONFIRM DIALOG ===== */}
      {/* zIndex 5500 > panel catatan (5000): konfirmasi "Hapus catatan" dibuka
          DARI panel itu. Dengan z-index overlay biasa (200) dialognya terlindung
          panel; di HP panel 320px menutupi hampir seluruh layar 390px sehingga
          tombol Ya/Tidak tidak bisa ditekan sama sekali. */}
      {confirmData && (
        <div className="win95-dialog-overlay" style={{ zIndex: 5500 }} role="presentation" onClick={() => { if (!confirmLoading) setConfirmData(null) }}>
          <div ref={confirmDialogRef} className="win95-dialog" role="dialog" aria-modal="true" aria-label={confirmData.title} style={{ maxWidth: 'min(350px, 95vw)' }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onKeyDown={trapDialogFocus}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">{confirmData.title}</span>{!confirmLoading && <button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setConfirmData(null)}>✕</button>}</div>
            <div className="win95-dialog-body" style={{ display: 'flex', alignItems: 'flex-start' }}><span className="win95-confirm-icon">⚠️</span><span className="win95-confirm-text">{confirmData.message}</span></div>
            <div className="win95-dialog-footer">
              <button className="win95-btn primary" disabled={confirmLoading} onClick={confirmData.onConfirm} style={confirmLoading ? { opacity: 0.6, cursor: 'wait' } : {}}>
                {confirmLoading ? '⏳ Memproses...' : (confirmData.confirmLabel || 'Ya')}
              </button>
              <button className="win95-btn" data-confirm-cancel disabled={confirmLoading} onClick={() => { if (!confirmLoading) setConfirmData(null) }}>{confirmData.cancelLabel || 'Tidak'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TASK CONTEXT MENU (Fix #1: clamped, Fix #8: duplicate, Fix #9: move) ===== */}
      {contextMenu && (
        <div ref={taskCtxRef} className="win95-context-menu" style={{ left: contextMenu.x, top: contextMenu.y, zIndex: 6000 }}>
          <div className="win95-context-item" onClick={() => { openDetail(contextMenu.task); setContextMenu(null) }}>📋 Detail</div>
          <div className="win95-context-item" onClick={() => { openEdit(contextMenu.task); setContextMenu(null) }}>✏️ Edit</div>

          {contextMenu.task.status === 'siap' && <div className="win95-context-item" onClick={() => { complete(contextMenu.task.id); setContextMenu(null) }}>✅ Selesaikan</div>}
          {contextMenu.task.status !== 'siap' && contextMenu.task.scheduleType !== 'sekali' && contextMenu.task.scheduleType !== 'tanggal_spesifik' && <div className="win95-context-item" onClick={() => { reset(contextMenu.task.id); setContextMenu(null) }}>🔄 Reset</div>}
          {contextMenu.task.status === 'selesai' && <div className="win95-context-item" onClick={() => { void undoLastComplete(contextMenu.task); setContextMenu(null) }}>↩ Batalkan selesai</div>}
          <div className="win95-context-item" onClick={() => { togglePin(contextMenu.task); setContextMenu(null) }}>{contextMenu.task.pinned ? '📌 Unpin' : '📌 Pin'}</div>
          {isSafeHttpUrl(contextMenu.task.link) && (
            <div className="win95-context-item" onClick={() => {
              const t = contextMenu.task
              if (settings.autoCompleteLink && t.status === 'siap') {
                completeAndOpenLink(t)
              } else {
                window.open(t.link!, '_blank', 'noopener,noreferrer')
              }
              setContextMenu(null)
            }}>🔗 {settings.autoCompleteLink && contextMenu.task.status === 'siap' ? 'Buka + Selesaikan' : 'Buka Link'}</div>
          )}
          <div className="win95-context-sep" />
          {/* Fix #8: Duplicate */}
          <div className="win95-context-item" onClick={() => { duplicateTask(contextMenu.task); setContextMenu(null) }}>📄 Duplikat</div>
          {/* Fix #9: Move to project */}
          <div className="win95-context-item" onClick={() => { setMoveDialogTask(contextMenu.task); setMoveTargetProjectId(null); setContextMenu(null) }}>📦 Pindah ke Project</div>
          <div className="win95-context-sep" />
          <div className="win95-context-item" style={{ color: '#cc0000' }} onClick={() => { delTask(contextMenu.task.id); setContextMenu(null) }}>🗑️ Hapus</div>
        </div>
      )}

      {/* ===== SHARE PROJECT DIALOG ===== */}
      {dialogType === 'share' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">🔗 Share Project</span><button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body">
              {!shareCode ? (
                <>
                  <div style={{ marginBottom: 8 }}>Share project <b>"{shareProjectName}"</b> dengan teman?</div>
                  <div className="win95-field">
                    <label>Semua tugas di proyek ini dibagikan, termasuk link, deskripsi, dan catatan. Siapa pun yang memiliki kode dapat mengimpornya.</label>
                  </div>
                  <div className="win95-field">
                    <label style={{ fontSize: 10, color: '#666' }}>Teman bisa import project + task ini menggunakan kode share</label>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ marginBottom: 12 }}>Project <b>"{shareProjectName}"</b> berhasil di-share!</div>
                  <div className="win95-field">
                    <label>Kode Share</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                      <input type="text" className="win95-input" value={shareCode} readOnly style={{ fontFamily: 'monospace', fontSize: 20, textAlign: 'center', letterSpacing: 4, fontWeight: 'bold', flex: 1 }} />
                      <button className="win95-btn" onClick={copyShareCode} title="Salin kode">📋 Salin</button>
                    </div>
                  </div>
                  <div className="win95-field">
                    <label>Kirim kode ini ke teman, lalu teman buka:</label>
                    <div style={{ fontSize: 11, marginTop: 2 }}>File → Import Share Code</div>
                  </div>
                  <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>({shareTaskCount} task termasuk dalam share)</div>
                </>
              )}
            </div>
            <div className="win95-dialog-footer">
              {!shareCode ? (
                <button className="win95-btn primary" onClick={doShareProject} disabled={shareLoading} style={{ opacity: shareLoading ? 0.6 : 1 }}>
                  {shareLoading ? '⏳ Generating...' : '🔗 Generate Kode Share'}
                </button>
              ) : (
                <button className="win95-btn primary" onClick={() => setDialogType(null)}>Tutup</button>
              )}
              {!shareCode && <button className="win95-btn" onClick={() => setDialogType(null)}>Batal</button>}
            </div>
          </div>
        </div>
      )}

      {/* ===== IMPORT SHARE CODE DIALOG ===== */}
      {dialogType === 'import-share' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">📥 Import Share Code</span><button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body">
              <div className="win95-field">
                <label>Masukkan Kode Share *</label>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <input
                    type="text" className="win95-input"
                    value={importCode}
                    onChange={e => { setImportCode(e.target.value.toUpperCase()); setImportPreview(null) }}
                    placeholder="Contoh: ABC123"
                    maxLength={6}
                    style={{ fontFamily: 'monospace', fontSize: 20, textAlign: 'center', letterSpacing: 4, fontWeight: 'bold', flex: 1, textTransform: 'uppercase' }}
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter' && importCode.trim().length === 6) checkShareCode() }}
                  />
                  <button className="win95-btn" onClick={checkShareCode} disabled={importChecking || importCode.trim().length !== 6} style={{ opacity: (importChecking || importCode.trim().length !== 6) ? 0.6 : 1 }}>
                    {importChecking ? '⏳' : '🔍 Cek'}
                  </button>
                </div>
                <div className="hint">6 karakter huruf + angka dari teman kamu</div>
              </div>
              {importPreview && (
                <div style={{ marginTop: 12, padding: 8, border: '1px solid #808080', background: '#ffffcc' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 4 }}>📋 Preview:</div>
                  <div>Project: <b>{importPreview.project.name}</b></div>
                  <div>Task: <b>{importPreview.taskCount}</b> task</div>
                  <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>Task akan di-import dengan status "Siap" (belum dikerjakan)</div>
                </div>
              )}
              {!importPreview && importCode.trim().length === 6 && !importChecking && (
                <div style={{ fontSize: 10, color: '#666', marginTop: 8 }}>Ketik kode lalu klik "Cek" untuk melihat preview</div>
              )}
            </div>
            <div className="win95-dialog-footer">
              {importPreview ? (
                <button className="win95-btn primary" onClick={doImportShare} disabled={importLoading} style={{ opacity: importLoading ? 0.6 : 1 }}>
                  {importLoading ? '⏳ Importing...' : `📥 Import "${importPreview.project.name}"`}
                </button>
              ) : (
                <div />
              )}
              <button className="win95-btn" onClick={() => setDialogType(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TEMPLATE TASK DIALOG ===== */}
      {dialogType === 'templates' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} style={{ maxWidth: 'min(500px, 95vw)', maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">📋 Template Task</span><button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body">
              {templateDialogOpen ? (
                <>
                  <div className="win95-field"><label>Nama Template *</label><input type="text" className="win95-input" value={formTemplateName} onChange={e => setFormTemplateName(e.target.value)} placeholder="Contoh: Daily Claim" autoFocus /></div>
                  <div className="win95-field"><label>Deskripsi</label><textarea className="win95-textarea" rows={2} value={formTemplateDesc} onChange={e => setFormTemplateDesc(e.target.value)} placeholder="Detail template..." /></div>
                  <div className="win95-field"><label>Link</label><input type="text" className="win95-input" value={formTemplateLink} onChange={e => setFormTemplateLink(e.target.value)} placeholder="https://..." /></div>
                  <div className="win95-field"><label>Jadwal</label>
                    <select className="win95-select" value={formTemplateScheduleType} onChange={e => { setFormTemplateScheduleType(e.target.value); setFormTemplateScheduleConfig({}) }}>
                      {Object.entries(SCHEDULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="win95-field"><label>Prioritas</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 11 }}>
                        <input type="radio" name="tplPriority" value="high" checked={formTemplatePriority === 'high'} onChange={() => setFormTemplatePriority('high')} /> 🔴 Tinggi
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 11 }}>
                        <input type="radio" name="tplPriority" value="medium" checked={formTemplatePriority === 'medium'} onChange={() => setFormTemplatePriority('medium')} /> 🟡 Sedang
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 11 }}>
                        <input type="radio" name="tplPriority" value="low" checked={formTemplatePriority === 'low'} onChange={() => setFormTemplatePriority('low')} /> 🟢 Rendah
                      </label>
                    </div>
                  </div>
                  {/* Fix B7: Schedule config editor for templates */}
                  {renderSchedCfg(formTemplateScheduleConfig, (k, v) => setFormTemplateScheduleConfig(p => ({ ...p, [k]: v })), formTemplateScheduleType)}
                </>
              ) : (
                <>
                  {templates.length === 0 ? (
                    <div className="empty-state" style={{ padding: 12 }}>
                      <div className="icon">📋</div>
                      <div>Belum ada template</div>
                      <div style={{ fontSize: 10, color: '#808080' }}>Simpan task yang sering dipakai sebagai template</div>
                    </div>
                  ) : (
                    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                      {templates.map(tpl => (
                        <div key={tpl.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 4px', borderBottom: '1px solid #e0e0e0', fontSize: 11 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: priorityDot(tpl.priority), flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold' }}>{tpl.name}</div>
                            <div style={{ fontSize: 10, color: '#808080' }}>{SCHEDULE_LABELS[tpl.scheduleType] || tpl.scheduleType}{tpl.link ? ' · 🔗' : ''}</div>
                          </div>
                          <button className="win95-btn" style={{ fontSize: 9, padding: '1px 6px', minWidth: 'auto' }} onClick={() => openEditTemplate(tpl)}>✏️</button>
                          <button className="win95-btn" style={{ fontSize: 9, padding: '1px 6px', minWidth: 'auto', color: '#cc0000' }} onClick={() => deleteTemplate(tpl.id)}>🗑️</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="win95-dialog-footer">
              {templateDialogOpen ? (
                <>
                  <button className="win95-btn primary" onClick={saveTemplate}>Simpan</button>
                  <button className="win95-btn" onClick={() => { setTemplateDialogOpen(false); setEditingTemplate(null) }}>Batal</button>
                </>
              ) : (
                <>
                  <button className="win95-btn primary" onClick={() => { setFormTemplateName(''); setFormTemplateDesc(''); setFormTemplateLink(''); setFormTemplateScheduleType('sekali'); setFormTemplateScheduleConfig({}); setFormTemplatePriority('medium'); setEditingTemplate(null); setTemplateDialogOpen(true) }}>+ Template Baru</button>
                  <button className="win95-btn" onClick={() => setDialogType(null)}>Tutup</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== PROJECT CONTEXT MENU (Fix #1: clamped, Fix #7: batch complete, Fix #16: sort) ===== */}
      {projectContextMenu && (
        <div ref={projCtxRef} className="win95-context-menu" style={{ left: projectContextMenu.x, top: projectContextMenu.y, zIndex: 6000 }}>
          {/* Item "Collapse/Expand" dihapus: sisa tampilan pohon lama. Sejak
              daftar tugas jadi kartu + sidebar, tidak ada folder yang bisa
              dilipat, jadi tombolnya hanya mengganti label tanpa efek apa pun.
              Menyaring proyek cukup dengan mengklik namanya di sidebar. */}
          <div className="win95-context-item" onClick={() => { openAdd(projectContextMenu.project.id); setProjectContextMenu(null) }}>➕ Tambah Task</div>
          {/* Fix #7: Batch Complete All Ready */}
          <div className={`win95-context-item ${batchCompleting === projectContextMenu.project.id ? 'disabled' : ''}`}
            onClick={() => {
              if (batchCompleting === projectContextMenu.project.id) return
              batchComplete(projectContextMenu.project.id)
              setProjectContextMenu(null)
            }}>
            {batchCompleting === projectContextMenu.project.id ? '⏳ Menyelesaikan...' : '✅ Complete Semua Siap'}
          </div>
          <div className="win95-context-item" onClick={() => { openEditProject(projectContextMenu.project); setProjectContextMenu(null) }}>✏️ Edit Nama/Warna</div>
          <div className="win95-context-sep" />
          {/* Per-project export */}
          <div className="win95-context-item" onClick={() => { doExportProject(projectContextMenu.project.id); setProjectContextMenu(null) }}>📤 Export Project</div>
          {/* Per-project import */}
          <div className="win95-context-item" onClick={() => { projectImportTargetRef.current = projectContextMenu.project.id; fileInputProjectImportRef.current?.click(); setProjectContextMenu(null) }}>📥 Import ke Project</div>
          {/* Share project */}
          <div className="win95-context-item" onClick={() => { openShareProject(projectContextMenu.project); setProjectContextMenu(null) }}>🔗 Share Project</div>
          <div className="win95-context-sep" />
          {/* Fix #16: Sort A-Z toggle */}
          <div className="win95-context-item" onClick={() => { setProjectSort(projectSort === 'az' ? 'default' : 'az'); setProjectContextMenu(null) }}>
            {projectSort === 'az' ? '🔢 Sort Default' : '🔤 Sort A-Z'}
          </div>
          <div className="win95-context-sep" />
          <div className="win95-context-item" style={{ color: '#cc0000' }} onClick={() => { delProject(projectContextMenu.project); setProjectContextMenu(null) }}>🗑️ Hapus Project</div>
        </div>
      )}

      {/* ===== PANDUAN SINGKAT ===== */}
      {dialogType === 'help' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog help-dialog" role="dialog" aria-modal="true" aria-label="Panduan penggunaan" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">📖 Panduan singkat</span><button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body help-body simple-help">
              <h2>Mulai dari sini</h2>
              <ol>
                <li><b>Tambah tugas.</b> Tekan <b>+ Tugas Baru</b>, isi nama dan pilih kapan dikerjakan. Proyek dan link tidak wajib.</li>
                <li><b>Tambah tugas ke proyek.</b> Pilih proyek dulu (sidebar atau Monitor), lalu tekan <b>＋ Tambah tugas di (nama proyek)</b> di bawah daftar. Tombol toolbar juga berubah jadi <b>+ Tugas di (nama proyek)</b>, dan bisa lewat klik kanan / tekan lama nama proyek → <b>Tambah Task</b>.</li>
                <li><b>Banyak tugas sekaligus.</b> Isi tugas pertama lalu tekan <b>Simpan & tambah lagi</b>. Nama/link/deskripsi dikosongkan untuk tugas berikutnya, tetapi proyek, jadwal, dan prioritas tetap. Setiap tugas disimpan terpisah; kalau satu gagal, yang sudah tersimpan tidak hilang.</li>
                <li><b>Kerjakan tugas yang siap.</b> Tekan <b>Buka link</b> jika ada, lalu kembali ke sini dan tekan <b>Selesai</b> setelah selesai.</li>
                <li><b>Lihat kapan siap lagi.</b> Tugas berulang pindah ke <b>Menunggu</b>. Tugas satu kali ada di tab <b>Selesai</b>.</li>
              </ol>
              <p>Jika pengaturan <b>otomatis selesaikan saat membuka link</b> diaktifkan, tombol akan bertuliskan <b>Buka + selesai</b>.</p>
              <details>
                <summary>Memilih jadwal</summary>
                <ul><li><b>Sekali saja:</b> tidak berulang.</li><li><b>Setiap hari:</b> jam tetap, misalnya 00:00 setiap hari.</li><li><b>Beberapa jam setelah selesai:</b> misalnya 24 jam setelah Anda menekan Selesai, bukan selalu tengah malam.</li><li><b>Setiap minggu:</b> pilih hari.</li><li><b>Mulai tanggal tertentu:</b> tugas sekali yang siap sejak tanggal itu; bukan batas akhir.</li></ul>
              </details>
              <details>
                <summary>Memilih beberapa tugas dan membatalkan</summary>
                <p>Tekan <b>Pilih beberapa</b>, pilih tugas, lalu <b>Selesaikan pilihan</b>. Jika salah menandai selesai, tekan <b>Undo</b> di pemberitahuan yang muncul. Menghapus riwayat adalah aksi berbeda dan tidak dapat dibatalkan.</p>
              </details>
              <p className="simple-help-note">Buka panduan ini lagi melalui menu <b>Bantuan</b>.</p>
            </div>
            <div className="win95-dialog-footer"><button className="win95-btn" onClick={() => setDialogType(null)}>Tutup</button><button className="win95-btn primary" onClick={() => { setDialogType(null); openAddStandalone() }}>+ Buat tugas</button></div>
          </div>
        </div>
      )}

      {/* ===== ADMIN PANEL DIALOG ===== */}
      {dialogType === 'admin' && isAdmin && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" style={{ maxWidth: 'min(700px, 95vw)', width: '95vw', maxHeight: '85vh' }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar">
              <span className="win95-titlebar-text">👑 Panel Admin</span>
              <button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setDialogType(null)}>✕</button>
            </div>
            <div className="win95-dialog-body" style={{ maxHeight: 'calc(85vh - 60px)', overflowY: 'auto', padding: 12 }}>
              {adminLoading ? (
                <div style={{ textAlign: 'center', padding: 20 }}>Memuat data...</div>
              ) : (
                <>
                  {/* === DAFTAR USER === */}
                  <fieldset className="win95-group" style={{ marginBottom: 12 }}>
                    <legend>👥 Daftar User ({adminUsers.length})</legend>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #808080' }}>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Username</th>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Nama</th>
                            <th style={{ textAlign: 'center', padding: '4px 6px' }}>Role</th>
                            <th style={{ textAlign: 'center', padding: '4px 6px' }}>Project</th>
                            <th style={{ textAlign: 'center', padding: '4px 6px' }}>Task</th>
                            <th style={{ textAlign: 'center', padding: '4px 6px' }}>Status</th>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Invite Code</th>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Bergabung</th>
                            <th style={{ textAlign: 'center', padding: '4px 6px' }}>Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminUsers.map(u => (
                            <tr key={u.id} style={{ borderBottom: '1px solid #c0c0c0', background: u.isBlocked ? '#FFE0E0' : (u.id === authUser?.id ? '#E0FFE0' : 'transparent') }}>
                              <td style={{ padding: '3px 6px' }}>
                                <b>@{u.username}</b>
                                {u.id === authUser?.id && <span style={{ color: '#006600', fontSize: 9 }}> (anda)</span>}
                              </td>
                              <td style={{ padding: '3px 6px' }}>{u.displayName || '-'}</td>
                              <td style={{ textAlign: 'center', padding: '3px 6px' }}>
                                <span style={{ color: u.role === 'ADMIN' ? '#006600' : '#808080', fontWeight: u.role === 'ADMIN' ? 'bold' : 'normal' }}>
                                  {u.role === 'ADMIN' ? '👑 Admin' : '👤 User'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center', padding: '3px 6px' }}>{u._count.projects}</td>
                              <td style={{ textAlign: 'center', padding: '3px 6px' }}>{u._count.tasks}</td>
                              <td style={{ textAlign: 'center', padding: '3px 6px' }}>
                                <span style={{ color: u.isBlocked ? '#CC0000' : '#006600', fontWeight: 'bold' }}>
                                  {u.isBlocked ? '⛔ DIBLOKIR' : '✅ Aktif'}
                                </span>
                              </td>
                              <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontSize: 10 }}>{u.inviteCode || '-'}</td>
                              <td style={{ padding: '3px 6px', fontSize: 10 }}>{new Date(u.createdAt).toLocaleDateString('id-ID')}</td>
                              <td style={{ textAlign: 'center', padding: '3px 6px' }}>
                                {u.id !== authUser?.id && (
                                  <button
                                    className="win95-btn"
                                    style={{ fontSize: 10, padding: '1px 8px', color: u.isBlocked ? '#006600' : '#CC0000' }}
                                    onClick={() => toggleBlockUser(u)}
                                  >
                                    {u.isBlocked ? '✅ Unblock' : '⛔ Block'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </fieldset>

                  {/* === INVITE CODES === */}
                  <fieldset className="win95-group">
                    <legend>🎫 Kode Undangan ({adminInviteCodes.length})</legend>
                    <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="win95-btn" style={{ fontSize: 10 }} onClick={() => createUserInviteCode('USER')}>+ Buat Kode User</button>
                      <button className="win95-btn" style={{ fontSize: 10, color: '#006600' }} onClick={() => createUserInviteCode('ADMIN')}>+ Buat Kode Admin</button>
                      <button className="win95-btn" style={{ fontSize: 10 }} onClick={fetchAdminData}>🔄 Refresh</button>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #808080' }}>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Kode</th>
                            <th style={{ textAlign: 'center', padding: '4px 6px' }}>Role</th>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Digunakan Oleh</th>
                            <th style={{ textAlign: 'left', padding: '4px 6px' }}>Digunakan Pada</th>
                            <th style={{ textAlign: 'center', padding: '4px 6px' }}>Status</th>
                            <th style={{ textAlign: 'center', padding: '4px 6px' }}>Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminInviteCodes.map(c => (
                            <tr key={c.id} style={{ borderBottom: '1px solid #c0c0c0' }}>
                              <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: 1 }}>{c.code}</td>
                              <td style={{ textAlign: 'center', padding: '3px 6px' }}>
                                <span style={{ color: c.role === 'ADMIN' ? '#006600' : '#808080', fontWeight: c.role === 'ADMIN' ? 'bold' : 'normal' }}>
                                  {c.role === 'ADMIN' ? '👑 Admin' : '👤 User'}
                                </span>
                              </td>
                              <td style={{ padding: '3px 6px' }}>{c.user ? `@${c.user.username}` : '-'}</td>
                              <td style={{ padding: '3px 6px', fontSize: 10 }}>{c.usedAt ? fmtFull(new Date(c.usedAt)) : '-'}</td>
                              <td style={{ textAlign: 'center', padding: '3px 6px' }}>
                                <span style={{ color: c.usedBy ? '#808080' : '#000080' }}>
                                  {c.usedBy ? '✅ Terpakai' : '🆓 Tersedia'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center', padding: '3px 6px' }}>
                                {!c.usedBy && (
                                  <button className="win95-btn" style={{ fontSize: 10, padding: '1px 8px', color: '#CC0000' }} onClick={() => deleteInviteCode(c)}>🗑️</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </fieldset>
                </>
              )}
            </div>
            <div className="win95-dialog-footer">
              <button className="win95-btn primary" onClick={() => setDialogType(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== NOTES PANEL (side panel like Notepad) ===== */}
      {notesPanelOpen && (
        <div className="notes-panel-fixed" style={{ position: 'fixed', top: 0, right: 0, width: 320, height: '100vh', zIndex: 5000, display: 'flex', flexDirection: 'column' }}>
          <div className="win95-window" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="win95-titlebar">
              <span className="win95-titlebar-text">📝 Catatan</span>
              <button className="win95-titlebar-btn" aria-label="Tutup" onClick={() => setNotesPanelOpen(false)}>✕</button>
            </div>
            {/* Note input area */}
            <div style={{ padding: 6, borderBottom: '1px solid #808080', background: '#d4d0c8' }}>
              <textarea
                className="win95-textarea"
                rows={3}
                placeholder="Tulis catatan..."
                value={noteFormContent}
                onChange={e => setNoteFormContent(e.target.value)}
                style={{ width: '100%', fontSize: 11, marginBottom: 4, resize: 'vertical' }}
              />
              {/* flexWrap + minWidth:auto wajib: di layar ≥769px .win95-btn punya
                  min-width 100px, jadi 7 kotak warna + Batal + Simpan melampaui
                  panel 320px dan tombol Simpan terdorong keluar layar sehingga
                  catatan yang sedang diedit tidak bisa disimpan. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {['#FFFFCC', '#FFCCCC', '#CCFFCC', '#CCE5FF', '#E5CCFF', '#FFE5CC', '#FFFFFF'].map(c => (
                  <div key={c} onClick={() => setNoteFormColor(c)}
                    style={{ width: 18, height: 18, background: c, border: noteFormColor === c ? '2px solid #000' : '1px solid #808080', cursor: 'pointer', flexShrink: 0 }} />
                ))}
                <div style={{ flex: 1 }} />
                {editingNoteId && <button className="win95-btn" style={{ fontSize: 10, padding: '1px 8px', minWidth: 'auto' }} onClick={() => { setEditingNoteId(null); setNoteFormContent(''); setNoteFormColor('#FFFFCC') }}>Batal</button>}
                <button className="win95-btn primary" style={{ fontSize: 10, padding: '1px 8px', minWidth: 'auto' }} onClick={saveNote}>{editingNoteId ? 'Simpan' : 'Tambah'}</button>
              </div>
            </div>
            {/* Notes list */}
            <div className="win95-content" style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
              {notes.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <div className="icon" style={{ fontSize: 20 }}>📝</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>Belum ada catatan</div>
                  <div style={{ fontSize: 10, color: '#808080', marginTop: 2 }}>Tulis catatan di atas</div>
                </div>
              ) : (
                notes.map(note => (
                  <div key={note.id} style={{
                    background: note.color || '#FFFFFF',
                    border: '1px solid #808080',
                    marginBottom: 4,
                    padding: '6px 8px',
                    cursor: 'default',
                    boxShadow: '1px 1px 0 #000',
                    position: 'relative'
                  }}>
                    {note.pinned && <div style={{ position: 'absolute', top: 2, right: 4, fontSize: 10 }}>📌</div>}
                    <div style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, marginRight: note.pinned ? 16 : 0 }}>{note.content}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, fontSize: 9, color: '#808080' }}>
                      <span>{fmtDate(new Date(note.updatedAt))}</span>
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 2px' }} onClick={() => toggleNotePin(note)} title={note.pinned ? 'Unpin' : 'Pin'}>{note.pinned ? '📌' : '📍'}</button>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 2px' }} onClick={() => openEditNote(note)} title="Edit">✏️</button>
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 2px' }} onClick={() => deleteNote(note.id)} title="Hapus">🗑️</button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="win95-statusbar" style={{ padding: '2px 4px', fontSize: 10 }}>
              <div className="win95-statusbar-section">{notes.length} catatan</div>
            </div>
          </div>
        </div>
      )}

      {/* ===== TOAST ===== */}
      <div className="toast-container" role="status" aria-live="polite">{toasts.map((t) => {
        const icon = t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : '💡'
        const cls = t.type === 'success' ? 'win95-toast-success' : t.type === 'error' ? 'win95-toast-error' : 'win95-toast-info'
        return (
          <div key={t.id} className={`win95-toast ${cls}`}>
            <span className="win95-toast-msg">{icon} {t.msg}</span>
            {t.actionLabel && t.onAction && (
              <button
                className="win95-toast-action"
                onClick={() => { t.onAction!(); dismissToast(t.id) }}
              >
                ↩ {t.actionLabel}
              </button>
            )}
            <button className="win95-toast-close" aria-label="Tutup notifikasi" onClick={() => dismissToast(t.id)}>✕</button>
          </div>
        )
      })}</div>
    </div>
  )
}

/* ===== Highlighted Text ===== */
function HL({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i === -1) return <>{text}</>
  return <>{text.slice(0, i)}<span style={{ background: '#ffff00' }}>{text.slice(i, i + q.length)}</span>{text.slice(i + q.length)}</>
}

/* ===== Detail Dialog ===== */
function DetailDialog({ task, onClose, onEdit, onComplete, onReset, onUndoComplete, onDelete, onTogglePin, onSaveNotes, noteDraft, scheduleLabels, autoCompleteLink, fmtTime, fmtFull }: {
  task: Task; onClose: () => void; onEdit: () => void; onComplete: () => void; onReset: () => void; onUndoComplete: () => void
  onDelete: () => void; onTogglePin: () => void; onSaveNotes: (id: string, notes: string) => void; noteDraft?: string; scheduleLabels: Record<string, string>
  autoCompleteLink?: boolean; fmtTime: (d: Date) => string; fmtFull: (d: Date) => string
}) {
  const [notes, setNotes] = useState(noteDraft ?? task.notes ?? '')
  const isFocusedRef = useRef(false)
  // Sync notes state jika task.notes berubah dari luar (misal fetchData refresh)
  // Skip sync when user is actively typing (textarea focused) to prevent overwriting
  useEffect(() => { if (!isFocusedRef.current) setNotes(noteDraft ?? task.notes ?? '') }, [task.notes])
  const [saved, setSaved] = useState('')
  const blur = () => { if (notes !== (task.notes || '')) { onSaveNotes(task.id, notes); setSaved(fmtTime(new Date())) } }

  const statusText = task.status === 'siap' ? 'Siap sekarang' : task.status === 'cooldown' ? `Menunggu ${task.cooldownRemaining}` : 'Selesai'
  const isReady = task.status === 'siap'
  const canReset = task.status !== 'siap' && task.scheduleType !== 'sekali' && task.scheduleType !== 'tanggal_spesifik'

  const rows: { label: string; value: React.ReactNode }[] = []
  rows.push({
    label: 'Project',
    value: task.project ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 9, height: 9, background: task.project.color, border: '1px solid rgba(0,0,0,0.35)', display: 'inline-block' }} />
        {task.project.name}
      </span>
    ) : <span style={{ color: '#606060' }}>Tanpa proyek</span>,
  })
  rows.push({ label: 'Jadwal', value: scheduleLabels[task.scheduleType] || task.scheduleType })
  if (task.status === 'cooldown' && task.nextReadyAt) {
    rows.push({
      label: 'Siap pada',
      value: <b style={{ color: cooldownColor(task.cooldownMs) }}>{fmtFull(new Date(task.nextReadyAt))} · {task.cooldownRemaining} lagi</b>,
    })
  }
  if (task.scheduleType === 'tanggal_spesifik' && task.nextReadyAt && task.status !== 'selesai') {
    rows.push({ label: 'Tanggal target', value: <b style={{ color: 'var(--win95-siap)' }}>{fmtFull(new Date(task.nextReadyAt))}</b> })
  }
  if (task.lastCompletedAt) rows.push({ label: 'Terakhir selesai', value: fmtFull(new Date(task.lastCompletedAt)) })
  if ((task.logCount ?? 0) > 0) rows.push({ label: 'Sudah diselesaikan', value: `${task.logCount}×` })
  if (task.link) {
    rows.push({
      label: 'Link',
      value: (
        isSafeHttpUrl(task.link) ? <a href={task.link} target="_blank" rel="noopener noreferrer" style={{ color: '#000080' }} onClick={e => e.stopPropagation()}>
          {task.link.length > 42 ? task.link.slice(0, 42) + '…' : task.link}
        </a> : <span>Link tidak valid — edit tugas untuk memperbaiki</span>
      ),
    })
  }
  rows.push({
    label: 'Dibuat',
    value: task.createdAt && !isNaN(new Date(task.createdAt).getTime()) ? fmtFull(new Date(task.createdAt)) : '—',
  })

  return (
    <div className="win95-dialog-overlay" role="presentation" onClick={onClose}>
      <div className="win95-dialog detail-dialog" role="dialog" aria-modal="true" aria-label={`Detail ${task.name}`} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <div className="win95-titlebar">
          <span className="win95-titlebar-text" title={task.name}>📋 {task.name}</span>
          <button className="win95-titlebar-btn" aria-label="Tutup" onClick={onClose}>✕</button>
        </div>

        <div className="detail-status" data-status={task.status}>
          <span className="detail-status-dot" />
          <b>{statusText}</b>
          {task.pinned && <span title="Disematkan">📌</span>}
          <span className="detail-status-prio" style={{ color: '#404040' }}>{priorityLabel(task.priority)}</span>
        </div>

        <div className="win95-dialog-body detail-body">
          <div className="detail-grid">
            {rows.map(r => (
              <div key={r.label} className="detail-row">
                <span className="detail-label">{r.label}</span>
                <span className="detail-value">{r.value}</span>
              </div>
            ))}
          </div>

          {task.description && (
            <div className="detail-desc">{task.description}</div>
          )}

          <label htmlFor="detail-task-notes" className="detail-notes-label">
            Catatan {noteDraft !== undefined ? <span style={{ fontWeight: 'normal', color: '#9b1c1c' }}>· belum tersimpan</span> : saved && <span style={{ fontWeight: 'normal', color: '#404040' }}>· dicoba simpan {saved}</span>}
          </label>
          <textarea
            className="win95-textarea detail-notes"
            id="detail-task-notes"
            rows={4}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onFocus={() => { isFocusedRef.current = true }}
            onBlur={e => { isFocusedRef.current = false; if (!(e.relatedTarget as HTMLElement | null)?.closest('.detail-note-retry')) blur() }}
            placeholder="Tulis catatan untuk task ini… (tersimpan otomatis)"
          />
          {noteDraft !== undefined && <button type="button" className="v3-btn detail-note-retry" onClick={() => onSaveNotes(task.id, notes)}>Simpan ulang catatan</button>}
        </div>

        <div className="win95-dialog-footer detail-footer">
          <div className="detail-footer-main">
            {isReady && (
              <button className="v3-btn v3-btn-primary" onClick={onComplete}>✓ Selesai</button>
            )}
            {canReset && <button className="v3-btn" onClick={onReset}>Hapus riwayat…</button>}
            {/* Tugas sekali tidak punya "Hapus riwayat" — tanpa tombol ini ia
                tidak bisa dikembalikan kalau keliru ditandai selesai. */}
            {task.status === 'selesai' && <button className="v3-btn" onClick={onUndoComplete}>↩ Batalkan selesai</button>}
            {isSafeHttpUrl(task.link) && (
              <button className="v3-btn" onClick={() => {
                if (autoCompleteLink && isReady) onComplete()
                window.open(task.link!, '_blank', 'noopener,noreferrer')
              }}>
                🔗 {autoCompleteLink && isReady ? 'Buka + Selesaikan' : 'Buka link'}
              </button>
            )}
          </div>
          <div className="detail-footer-side">
            <button className="v3-btn" onClick={onTogglePin}>{task.pinned ? '📌 Unpin' : '📌 Pin'}</button>
            <button className="v3-btn" onClick={onEdit}>✏️ Edit</button>
            <button className="v3-btn detail-danger" onClick={onDelete}>🗑️ Hapus</button>
            <button className="v3-btn" onClick={onClose}>Tutup</button>
          </div>
        </div>
      </div>
    </div>
  )
}
