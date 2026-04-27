'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'

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

interface TaskTemplate {
  id: string; name: string; description: string | null; link: string | null
  scheduleType: string; scheduleConfig: string; priority: string
  createdAt: string; updatedAt: string
}

const SCHEDULE_LABELS: Record<string, string> = {
  sekali: 'Sekali', harian: 'Harian', mingguan: 'Mingguan',
  jam_tertentu: 'Jam Tertentu', tanggal_spesifik: 'Tgl Spesifik', kustom: 'Kustom'
}
const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const TZ_OPTIONS = [
  { value: 'WIB', label: 'WIB (UTC+7)' },
  { value: 'WITA', label: 'WITA (UTC+8)' },
  { value: 'WIT', label: 'WIT (UTC+9)' }
]
const PROJECT_COLORS = ['#000080', '#008000', '#800000', '#808000', '#800080', '#008080', '#FF6600', '#9900CC']
const PRIORITY_DOT: Record<string, string> = { high: '#CC0000', medium: '#DAA520', low: '#228B22' }
const PRIORITY_LABEL: Record<string, string> = { high: '🔴 Tinggi', medium: '🟡 Sedang', low: '🟢 Rendah' }

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

  const [viewMode, setViewMode] = useState<'tree' | 'dashboard' | 'monitor'>('dashboard')
  const [dashFilterProject, setDashFilterProject] = useState<string | null>(null)
  const [dashFilterQuery, setDashFilterQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'siap' | 'cooldown' | 'selesai'>('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [dialogType, setDialogType] = useState<'add' | 'edit' | 'detail' | 'settings' | 'telegram' | 'edit-project' | 'add-project' | 'help' | 'share' | 'import-share' | 'notes' | 'admin' | 'templates' | null>(null)
  const [confirmData, setConfirmData] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: Task } | null>(null)
  const [projectContextMenu, setProjectContextMenu] = useState<{ x: number; y: number; project: Project } | null>(null)
  const [toasts, setToasts] = useState<{ msg: string; type: 'success' | 'error' | 'info'; id: number }[]>([])
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
  const [workingCountdown, setWorkingCountdown] = useState(10)
  const [workingCompleted, setWorkingCompleted] = useState(false)
  const [undoCountdown, setUndoCountdown] = useState(0) // countdown untuk tombol undo (detik tersisa)
  const workingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
  const [savingTask, setSavingTask] = useState(false)
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
  }
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [registerUsername, setRegisterUsername] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerDisplayName, setRegisterDisplayName] = useState('')
  const [registerInviteCode, setRegisterInviteCode] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  // Browser & Push notifications
  const prevTasksRef = useRef<Map<string, { status: string; cooldownMs: number }>>(new Map())
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'denied')
  const [pushSupported, setPushSupported] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)

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
      await navigator.serviceWorker.ready

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
      if (!vapidRes.ok) return
      const { publicKey } = await vapidRes.json()
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
      setPushSupported(false)
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
      new Notification(title, { body, icon: '/favicon.ico', badge: '/favicon.ico' })
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
        const mapped = (cache.tasks as Task[]).map((t: Task) => ({
          ...t,
          cooldownMs: t.nextReadyAt ? Math.max(0, new Date(t.nextReadyAt).getTime() - Date.now()) : 0
        }))
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

  // Periodic sync — stable interval, always calls latest fetchData
  useEffect(() => {
    const i = setInterval(() => fetchDataRef.current(false, true), 60000) // Reduced from 30s to 60s — less aggressive
    return () => clearInterval(i)
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
    const run = async () => { try { await fetch('/api/notify/run', { method: 'POST', credentials: 'include', headers: getAuthHeaders() }) } catch { /* silent */ } }
    run()
    const iv = setInterval(run, 60000) // Reduced from 30s to 60s
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
  useEffect(() => {
    const update = () => {
      const el = clockRef.current
      if (!el) return
      const fmt = el.dataset.fmt || '24'
      const tz = el.dataset.tz || 'Asia/Jakarta'
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

  const toast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastIdRef.current
    setToasts(p => [...p, { msg, type, id }])
    const timer = setTimeout(() => {
      setToasts(p => p.filter(t => t.id !== id))
      const idx = toastTimersRef.current.indexOf(timer)
      if (idx > -1) toastTimersRef.current.splice(idx, 1)
    }, type === 'error' ? 4000 : 2500)
    toastTimersRef.current.push(timer)
  }

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
    // No showGlobalLoading — optimistic update gives instant feedback
    try {
      const res = await api(`/api/tasks/${id}/complete`, { method: 'POST' })
      if (!res.ok) { toast('Gagal menyelesaikan task', 'error'); return }
      toast('Task selesai!', 'success')
      // Optimistic update: update task status locally
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'selesai' as const, cooldownRemaining: '', cooldownMs: 0 } : t))
      lastWriteTime.current = Date.now()
      delayedFetch()
    }
    catch { toast('Gagal menyelesaikan task', 'error') }
    finally { completingIdsRef.current.delete(id); setCompletingIds(p => { const n = new Set(p); n.delete(id); return n }) }
  }

  const resetTask = async (id: string) => {
    // No showGlobalLoading — optimistic update gives instant feedback
    try {
      const res = await api(`/api/tasks/${id}/reset`, { method: 'POST' })
      if (!res.ok) { toast('Gagal mereset task', 'error'); return }
      toast('Task di-reset!', 'success')
      // Optimistic update: update task status locally
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'siap' as const, nextReadyAt: null, cooldownRemaining: '', cooldownMs: 0 } : t))
      lastWriteTime.current = Date.now()
      delayedFetch()
    }
    catch { toast('Gagal mereset task', 'error') }
  }

  const reset = (id: string) => {
    setConfirmData({
      title: 'Reset Task', message: 'Yakin reset task ini? Log terakhir akan dihapus dan cooldown dimulai ulang.',
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

  const saveTask = async (skipDialogClose?: boolean) => {
    if (savingTask) return
    if (!formName.trim()) { toast('Nama wajib diisi!', 'error'); return }
    const isAdd = dialogType === 'add'
    const isEdit = dialogType === 'edit' && selectedTaskId
    if (!isAdd && !isEdit) return

    // Capture form values before any state changes
    const taskName = formName.trim()
    const taskDesc = formDesc || null
    const taskLink = formLink || null
    const taskScheduleType = formScheduleType
    const taskScheduleConfig = formScheduleConfig
    const taskProjectId = (formProjectId && formProjectId !== '__no_project__') ? formProjectId : null
    const taskPriority = formPriority
    const editTaskId = selectedTaskId

    setSavingTask(true)
    // No showGlobalLoading — optimistic update gives instant feedback

    // Optimistic update for ADD: create temp task immediately
    let tempId: string | null = null
    if (isAdd) {
      tempId = 'temp-' + Date.now()
      const newTask: Task = {
        id: tempId, name: taskName, description: taskDesc, link: taskLink,
        scheduleType: taskScheduleType, scheduleConfig: typeof taskScheduleConfig === 'string' ? taskScheduleConfig : JSON.stringify(taskScheduleConfig),
        notes: null, pinned: false, priority: taskPriority,
        status: 'siap', nextReadyAt: null, lastCompletedAt: null,
        cooldownRemaining: '', cooldownMs: 0,
        project: taskProjectId ? projects.find(p => p.id === taskProjectId) || null : null,
        createdAt: new Date().toISOString()
      }
      setTasks(prev => [newTask, ...prev])
      if (taskProjectId) setExpandedProjects(prev => new Set(prev).add(taskProjectId))
    }
    // Optimistic update for EDIT: update task in local state immediately
    if (isEdit && editTaskId) {
      setTasks(prev => prev.map(t => t.id === editTaskId ? {
        ...t, name: taskName, description: taskDesc, link: taskLink,
        scheduleType: taskScheduleType, scheduleConfig: typeof taskScheduleConfig === 'string' ? taskScheduleConfig : JSON.stringify(taskScheduleConfig),
        priority: taskPriority
      } : t))
    }

    // CRITICAL: Set write timestamp IMMEDIATELY to prevent periodic sync from overwriting optimistic state
    lastWriteTime.current = Date.now()

    // Close dialog immediately — user can already see the change
    if (!skipDialogClose) {
      setDialogType(null)
      setSelectedTaskId(null)
    }

    try {
      const body = JSON.stringify({
        name: taskName, description: taskDesc, link: taskLink,
        scheduleType: taskScheduleType, scheduleConfig: taskScheduleConfig,
        projectId: taskProjectId, priority: taskPriority
      })
      const makeOpts = (method: string) => ({ method, headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body, credentials: 'include' as RequestCredentials })
      let res: Response
      if (isAdd) {
        res = await fetch('/api/tasks', makeOpts('POST'))
        if (!res.ok) {
          // Revert optimistic update on failure
          if (tempId) setTasks(prev => prev.filter(t => t.id !== tempId))
          lastWriteTime.current = 0
          const err = await res.json().catch(() => ({})); toast('Gagal: ' + (err.error || res.statusText), 'error'); return
        }
        const data = await res.json()
        toast('Task ditambahkan!', 'success')
        // Replace temp ID with real ID
        if (tempId && data.id) {
          setTasks(prev => prev.map(t => t.id === tempId ? { ...t, id: data.id } : t))
        }
      } else if (isEdit && editTaskId) {
        res = await fetch(`/api/tasks/${editTaskId}`, makeOpts('PUT'))
        if (!res.ok) {
          // Revert on failure — re-fetch from server
          lastWriteTime.current = 0
          const err = await res.json().catch(() => ({})); toast('Gagal: ' + (err.error || res.statusText), 'error')
          delayedFetch()
          return
        }
        toast('Task diperbarui!', 'success')
      }
      lastWriteTime.current = Date.now()
      delayedFetch()
    } catch (e) {
      console.error(e)
      // Revert optimistic add on network error
      if (isAdd && tempId) setTasks(prev => prev.filter(t => t.id !== tempId))
      lastWriteTime.current = 0
      toast('Gagal menyimpan task', 'error')
    }
    finally { setSavingTask(false) }
  }

  const saveNotes = async (id: string, notes: string) => {
    // Optimistic: update local notes immediately
    setTasks(prev => prev.map(t => t.id === id ? { ...t, notes } : t))
    try { const res = await api(`/api/tasks/${id}`, jsonOpts('PUT', { notes })); if (!res.ok) { toast('Gagal menyimpan catatan', 'error'); return } } catch { toast('Gagal menyimpan catatan', 'error') }
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
          if (fail === 0) toast(`${ok} task selesai!`)
          else toast(`${ok} berhasil, ${fail} gagal`)
          // Revert any that actually failed
          if (fail > 0) {
            const okIds = new Set<string>()
            results.forEach((r, i) => {
              if (r.status === 'fulfilled') {
                const val = r.value
                if (val && val.ok) okIds.add(readyTasks[i].id)
              }
            })
            const failedIds = readyIds
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

  /* ===== getActiveTasks: exclude archived sekali/tanggal_spesifik from active counts ===== */
  // Must be defined BEFORE useMemo that references it (TDZ fix)
  const getActiveTasks = (pt: Task[]) => pt.filter(t => !(t.status === 'selesai' && (t.scheduleType === 'sekali' || t.scheduleType === 'tanggal_spesifik')))

  /* ===== Memoized active task counts (performance — avoid re-computing on every render) ===== */
  const activeTasks = useMemo(() => getActiveTasks(tasks), [tasks])
  const totalSiap = useMemo(() => activeTasks.filter(t => t.status === 'siap').length, [activeTasks])
  const totalCd = useMemo(() => activeTasks.filter(t => t.status === 'cooldown').length, [activeTasks])
  const totalDone = useMemo(() => tasks.filter(t => t.status === 'selesai').length, [tasks])
  const activeDone = useMemo(() => activeTasks.filter(t => t.status === 'selesai').length, [activeTasks])
  const totalArchived = useMemo(() => tasks.filter(t => t.status === 'selesai' && (t.scheduleType === 'sekali' || t.scheduleType === 'tanggal_spesifik')).length, [tasks])

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
    setConfirmData({
      title: 'Hapus Project', message: `Hapus project "${p.name}"? Semua task di dalamnya juga ikut terhapus.`,
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
  const completeAndOpenLink = async (t: Task) => {
    // Open link FIRST while still in user click context (avoids popup blocker)
    if (t.link) {
      window.open(t.link, '_blank', 'noopener,noreferrer')
    }
    if (t.status === 'siap') {
      await complete(t.id)
    }
  }

  /* ===== Kerjakan (Work on Task) ===== */
  const startWorking = (t: Task) => {
    if (t.status !== 'siap') return
    cancelWorking()
    setWorkingTaskId(t.id)
    setWorkingCountdown(10)
    setWorkingCompleted(false)
    setUndoCountdown(0)
    if (t.project?.id) setExpandedProjects(prev => new Set(prev).add(t.project!.id))
    if (t.link) window.open(t.link, '_blank', 'noopener,noreferrer')
    let count = 10
    workingTimerRef.current = setInterval(async () => {
      count--
      setWorkingCountdown(count)
      if (count <= 0) {
        if (workingTimerRef.current) { clearInterval(workingTimerRef.current); workingTimerRef.current = null }
        try {
          await complete(t.id)
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
      // Optimistic: revert task status locally + cancel working UI immediately
      cancelWorking()
      try {
        const res = await api(`/api/tasks/${workingTaskId}/undo`, { method: 'POST' })
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
        try { await api('/api/logout', { method: 'POST' }) } catch { /* server unreachable, proceed with local logout */ }
        setProfileMenuOpen(false)
        setConfirmData(null)
        setAuthenticated(false)
        setAuthUser(null)
        persistAuth(null)
        clearCache() // Clear user's cached data on logout
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
      if (!res.ok) { setAuthError('Login gagal. Periksa username dan password.'); return }
      const data = await res.json()
      if (data.success) {
        setAuthenticated(true)
        setAuthUser(data.user)
        persistAuth(data.user)
        setLoginUsername(''); setLoginPassword('')
        fetchData(false, true)
        fetchNotes()
        // Tampilkan help untuk user baru
        if (!localStorage.getItem('mbg_help_shown')) {
          const t = setTimeout(() => { setDialogType('help'); localStorage.setItem('mbg_help_shown', '1') }, 500)
          miscTimeoutsRef.current.push(t)
        }
      } else {
        setAuthError(data.error || 'Login gagal')
      }
    } catch { setAuthError('Gagal terhubung ke server') }
    finally { setAuthLoading(false); hideGlobalLoading() }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!registerInviteCode.trim()) { setAuthError('Kode undangan wajib diisi'); return }
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
      if (!res.ok) { setAuthError('Registrasi gagal. Silakan coba lagi.'); return }
      const data = await res.json()
      if (data.success) {
        setAuthenticated(true)
        setAuthUser(data.user)
        persistAuth(data.user)
        setRegisterUsername(''); setRegisterPassword(''); setRegisterDisplayName(''); setRegisterInviteCode('')
        fetchData(false, true)
        fetchNotes()
        // Tampilkan help untuk user baru (register selalu first time)
        const ht = setTimeout(() => { setDialogType('help'); localStorage.setItem('mbg_help_shown', '1') }, 500)
        miscTimeoutsRef.current.push(ht)
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
    // Optimistic: apply settings locally immediately
    const newSettings = { ...settings, timezone: formTimezone, timeFormat: formTimeFormat, autoExpandSiap: formAutoExpandSiap, autoCompleteLink: formAutoCompleteLink, telegramNotifEnabled: formTelegramNotif, browserNotifEnabled: formBrowserNotif, notifyBeforeCooldownMin: formNotifyBeforeMin, audioAlertEnabled: formAudioAlertEnabled }
    setSettings(newSettings)
    toast('Disimpan!', 'success')
    setDialogType(null)
    try {
      const res = await api('/api/settings', jsonOpts('PUT', { timezone: formTimezone, timeFormat: formTimeFormat, autoExpandSiap: formAutoExpandSiap, autoCompleteLink: formAutoCompleteLink, telegramNotifEnabled: formTelegramNotif, browserNotifEnabled: formBrowserNotif, notifyBeforeCooldownMin: formNotifyBeforeMin, audioAlertEnabled: formAudioAlertEnabled }))
      if (!res.ok) { toast('Gagal menyimpan di server', 'error'); return }
      // If user disabled browser notif, unregister push subscription
      if (formBrowserNotif !== settings.browserNotifEnabled && !formBrowserNotif) {
        unregisterPushSubscription()
      }
      delayedFetch()
    } catch { toast('Gagal menyimpan di server', 'error') }
  }

  /* ===== Openers ===== */
  const openAdd = (projectId: string | null) => {
    setFormProjectId(projectId)
    setFormName(''); setFormDesc(''); setFormLink(''); setFormScheduleType('sekali'); setFormScheduleConfig({})
    setFormPriority('medium')
    setDialogType('add')
  }
  const openAddStandalone = () => {
    openAdd(null)
    // Auto-expand the 'Tanpa Project' folder
    setExpandedProjects(prev => new Set(prev).add('__no_project__'))
  }

  const openEdit = (t: Task) => {
    setFormName(t.name); setFormDesc(t.description || ''); setFormLink(t.link || '')
    setFormScheduleType(t.scheduleType)
    try { setFormScheduleConfig(JSON.parse(t.scheduleConfig)) } catch { setFormScheduleConfig({}) }
    setFormProjectId(t.project?.id || null)
    setFormPriority(t.priority || 'medium')
    setSelectedTaskId(t.id); setDialogType('edit')
  }
  const openDetail = (t: Task) => { if (Date.now() - ctxOpenTimeRef.current < 300) return; detailRef.current = t; setSelectedTaskId(t.id); setDialogType('detail') }
  const openEditProject = (p: Project) => { setFormProjectName(p.name); setFormProjectColor(p.color); setSelectedTaskId(p.id); setDialogType('edit-project') }
  const openAddProject = () => { setFormProjectName(''); setFormProjectColor('#000080'); setDialogType('add-project') }
  const openSettings = () => { const s = settings as Record<string, unknown>; setFormTimezone((s.timezone as string) || 'WIB'); setFormTimeFormat(s.timeFormat === '12' ? '12' : '24'); setFormAutoExpandSiap(s.autoExpandSiap !== false); setFormAutoCompleteLink(s.autoCompleteLink === true); setFormTelegramNotif(s.telegramNotifEnabled !== false); setFormBrowserNotif(s.browserNotifEnabled !== false); setFormNotifyBeforeMin((s.notifyBeforeCooldownMin as number) || 5); setFormAudioAlertEnabled(s.audioAlertEnabled !== false); setDialogType('settings') }

  /* ===== Folder toggle ===== */
  const toggleFolder = (projectId: string) => {
    setExpandedProjects(prev => {
      const n = new Set(prev)
      if (n.has(projectId)) n.delete(projectId); else n.add(projectId)
      return n
    })
  }

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
    // Optimistic: update template list locally immediately
    const newTemplate: TaskTemplate = {
      id: editingTemplate?.id || 'temp-tpl-' + Date.now(),
      name: formTemplateName, description: formTemplateDesc || null, link: formTemplateLink || null,
      scheduleType: formTemplateScheduleType, scheduleConfig: JSON.stringify(formTemplateScheduleConfig), priority: formTemplatePriority,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
    if (editingTemplate) {
      setTemplates(prev => prev.map(t => t.id === editingTemplate.id ? newTemplate : t))
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
      if (editingTemplate) {
        res = await api(`/api/templates/${editingTemplate.id}`, jsonOpts('PUT', {
          name: formTemplateName, description: formTemplateDesc || null, link: formTemplateLink || null,
          scheduleType: formTemplateScheduleType, scheduleConfig: formTemplateScheduleConfig, priority: formTemplatePriority
        }))
        if (!res.ok) { toast('Gagal memperbarui template', 'error'); fetchTemplates(); return }
      } else {
        res = await api('/api/templates', jsonOpts('POST', {
          name: formTemplateName, description: formTemplateDesc || null, link: formTemplateLink || null,
          scheduleType: formTemplateScheduleType, scheduleConfig: formTemplateScheduleConfig, priority: formTemplatePriority
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

  /* ===== Keyboard shortcuts ===== */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur()
          // Jangan closeAll() jika user sedang menulis catatan (notes panel terbuka)
          if (!notesPanelOpen || tag !== 'TEXTAREA') closeAll()
        }
        // Feature 6: Ctrl+Enter in add task dialog
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (dialogType === 'add' || dialogType === 'edit')) {
          e.preventDefault(); saveTask()
        }
        return
      }
      switch (e.key) {
        case 'r': case 'R': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); fetchData(true) }; break
        case 'Escape': closeAll(); break
        case 'f': case 'F': case '/': e.preventDefault(); document.getElementById('search-input')?.focus(); break
        /* D shortcut: toggle Monitor */
        case 'd': case 'D': if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          setViewMode(prev => prev === 'monitor' ? 'tree' : 'monitor')
          if (viewMode !== 'monitor') setActiveTab('all')
        }; break
        /* Fix #14: N to add task */
        case 'n': case 'N': if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          // Open add task untuk project pertama yang expanded, atau standalone task
          const firstExpanded = expandedProjects.size > 0 ? Array.from(expandedProjects)[0] : null
          if (firstExpanded && firstExpanded !== '__no_project__') openAdd(firstExpanded)
          else openAddStandalone()
        }; break
        /* T shortcut: add standalone task (tanpa project) */
        case 't': case 'T': if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          openAddStandalone()
        }; break
        /* Feature 6: Number keys for filter tabs (switch to Dashboard view) */
        case '1': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setViewMode('dashboard'); setActiveTab('all'); setDashFilterQuery('') }; break
        case '2': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setViewMode('dashboard'); setActiveTab('siap'); setDashFilterQuery('') }; break
        case '3': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setViewMode('dashboard'); setActiveTab('cooldown'); setDashFilterQuery('') }; break
        case '4': if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); setViewMode('dashboard'); setActiveTab('selesai'); setDashFilterQuery('') }; break

        /* Feature 6: ? open help */
        case '?': e.preventDefault(); setDialogType('help'); break
      }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [expandedProjects, projects, viewMode, dialogType, notesPanelOpen])

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
            onClick={e => { e.stopPropagation(); if (loading) return; if (done) reset(t.id); else complete(t.id) }} readOnly />
        ) : null}
        {/* Feature 1: Priority dot */}
        <span className="priority-dot" style={{ background: PRIORITY_DOT[t.priority || 'medium'] || '#DAA520' }} title={PRIORITY_LABEL[t.priority || 'medium'] || 'Sedang'} />
        {t.pinned && <span className="task-pin">📌</span>}
        <span className="task-name" style={{ textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }} title={titleAttr}>
          {searchQuery ? <HL text={t.name} q={searchQuery} /> : t.name}
        </span>
        <span className="task-schedule-info">{SCHEDULE_LABELS[t.scheduleType] || t.scheduleType}</span>
        {t.status === 'cooldown' && t.cooldownRemaining && (
          <span className="task-cd-timer" title={t.nextReadyAt ? `Siap: ${fmtTime(new Date(t.nextReadyAt))}` : ''}>
            {t.cooldownRemaining}
          </span>
        )}
        {done && <span className="task-schedule-info">✓</span>}
        {t.link && (
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
            <button className="work-btn" onClick={e => { e.stopPropagation(); if (!loading) complete(t.id) }} title="Selesai" style={{ color: 'var(--win95-siap)' }}>✓ Selesai</button>
          </div>
        )}
      </div>
    )
  }

  /* ===== Fix #6: Pinned tasks sort first in status groups ===== */
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
  const renderFolder = (p: Project) => {
    const isExpanded = expandedProjects.has(p.id)
    const stats = getProjectStats(p.id)
    const pt = tasks.filter(t => t.project?.id === p.id)
    const activePt = getActiveTasks(pt)

    /* Fix #4: pass project name for search matching */
    const filtered = filterTasks(pt, p.name)
    const fSiap = filtered.filter(t => t.status === 'siap')
    const fCd = filtered.filter(t => t.status === 'cooldown')
    const fDone = filtered.filter(t => t.status === 'selesai')

    // When searching, force expand all matching folders
    const shouldExpand = debouncedSearch.trim() ? filtered.length > 0 : isExpanded

    /* Fix #4: hide folder if searching and no match */
    if (debouncedSearch.trim() && filtered.length === 0) return null

    return (
      <div key={p.id} className="tree-folder">
        {/* Folder Header Row */}
        <div className="tree-folder-header" onContextMenu={e => handleProjCtx(e, p)} onTouchStart={e => handleProjTouchStart(e, p)} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}>
          <span className={`tree-toggle ${shouldExpand ? '' : 'collapsed'}`} onClick={() => toggleFolder(p.id)}>
            {shouldExpand ? '📂' : '📁'}
          </span>
          <div className="tree-folder-color" style={{ background: p.color }} />
          <span className="tree-folder-name" onClick={() => toggleFolder(p.id)} style={{ flex: 1 }}>
            {searchQuery ? <HL text={p.name} q={searchQuery} /> : p.name}
          </span>
          {/* Fix #11: Total task count */}
          <span className="tree-stat tree-task-count">{stats.total} task</span>
          {stats.siap > 0 && <span className="tree-stat" style={{ color: 'var(--win95-siap)' }}>✅{stats.siap}</span>}
          {stats.cd > 0 && <span className="tree-stat" style={{ color: 'var(--win95-cd)' }}>⏳{stats.cd}</span>}
          {stats.done > 0 && <span className="tree-stat" style={{ color: '#808080' }}>✔{stats.done}</span>}
          {stats.archived > 0 && <span className="tree-stat" style={{ color: '#b0b0b0', fontWeight: 'normal' }}>📁{stats.archived}</span>}
          {/* Add task button */}
          <button className="tree-add-btn" onClick={() => openAdd(p.id)} title="Tambah Task">+</button>
        </div>

        {/* Folder Content (tasks inside) */}
        {shouldExpand && (
          <div className="tree-folder-content">
            {filtered.length === 0 && activePt.length === 0 ? (
              <div className="empty-state" style={{ padding: '12px 16px 8px' }}>
                <div style={{ fontSize: 10 }}>Belum ada task. Klik <b>+</b> untuk menambahkan.</div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state" style={{ padding: '12px 16px 8px' }}>
                <div className="icon" style={{ fontSize: 16 }}>🔍</div>
                <div style={{ fontSize: 10 }}>Tidak ditemukan</div>
              </div>
            ) : activeTab === 'all' ? (
              <>
                {renderStatusGroup('✅ SIAP', fSiap, `siap-${p.id}`, 'var(--win95-siap)')}
                {renderStatusGroup('⏳ COOLDOWN', fCd, `cd-${p.id}`, 'var(--win95-cd)')}
                {renderStatusGroup('✔️ SELESAI', fDone, `done-${p.id}`, '#808080')}
              </>
            ) : (
              <div className="tree-status-content">
                {sortTasksByPriorityAndPin(filtered).map(renderRow)}
              </div>
            )}
          </div>
        )}

        {/* Kerjakan Working Panel */}
        {workingTaskId && (() => {
          const wt = tasks.find(t => t.id === workingTaskId)
          if (!wt || wt.project?.id !== p.id) return null
          return (
            <div className="working-panel">
              {workingCompleted ? (
                <>
                  <div className="working-done-text">✅ <b>{wt.name}</b> telah diselesaikan</div>
                  <button className="win95-btn" onClick={e => { e.stopPropagation(); undoWorkingComplete() }} style={{ fontSize: 10, padding: '2px 10px' }}>↩️ Batalkan (Undo) — {undoCountdown}d</button>
                </>
              ) : (
                <>
                  <div className="working-header">🔨 Mengerjakan: <b>{wt.name}</b></div>
                  {wt.link && <div className="working-link" title={wt.link}>🔗 {wt.link}</div>}
                  <div className="working-progress">
                    <div className="working-progress-bar">
                      <div className="working-progress-fill" style={{ width: `${((10 - workingCountdown) / 10) * 100}%` }} />
                    </div>
                  </div>
                  <div className="working-timer">⏱ Otomatis selesai dalam <b>{workingCountdown}</b> detik</div>
                  <button className="win95-btn" onClick={e => { e.stopPropagation(); cancelWorking() }} style={{ fontSize: 10, padding: '2px 10px' }}>❌ Batalkan</button>
                </>
              )}
            </div>
          )
        })()}
      </div>
    )
  }

  /* ===== Render: Schedule Config (for task form and template form) ===== */
  const renderSchedCfg = (config: Record<string, unknown> = formScheduleConfig, setConfig: (k: string, v: unknown) => void = (k, v) => setFormScheduleConfig(p => ({ ...p, [k]: v })), schedType: string = formScheduleType) => {
    const uc = setConfig
    switch (schedType) {
      case 'harian': return (<div className="schedule-config-area"><div className="win95-field"><label>Cooldown (jam)</label><input type="number" className="win95-input" value={Number(config.cooldownHours || 24)} min={1} max={168} onChange={e => uc('cooldownHours', +e.target.value)} /><div className="hint">Waktu tunggu setelah selesai</div></div></div>)
      case 'mingguan': return (<div className="schedule-config-area"><div className="win95-field"><label>Hari</label><select className="win95-select" value={(config.dayOfWeek as number) ?? 0} onChange={e => uc('dayOfWeek', +e.target.value)}>{DAYS_ID.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></div><div className="win95-field"><label>Cooldown (jam)</label><input type="number" className="win95-input" value={Number(config.cooldownHours || 24)} min={1} max={168} onChange={e => uc('cooldownHours', +e.target.value)} /></div></div>)
      case 'jam_tertentu': return (<div className="schedule-config-area"><div className="win95-field"><label>Jam Eksekusi</label><input type="text" className="win95-input" placeholder="09:00, 15:00, 21:00" value={(config.times as string[])?.join(', ') || ''} onChange={e => uc('times', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} /><div className="hint">Format: JJ:MM, pisahkan koma</div></div></div>)
      case 'tanggal_spesifik': return (<div className="schedule-config-area"><div className="win95-field"><label>Tanggal Target</label><textarea className="win95-textarea" rows={2} placeholder="2026-05-01" value={(config.dates as string[])?.join('\n') || ''} onChange={e => uc('dates', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))} /><div className="hint">Format: YYYY-MM-DD — task sekali, tanggal sebagai deadline</div></div></div>)
      case 'kustom': return (<div className="schedule-config-area"><div className="win95-field"><label>Cooldown (jam)</label><input type="number" className="win95-input" value={Number(config.cooldownHours || 24)} min={1} max={8760} onChange={e => uc('cooldownHours', +e.target.value)} /></div></div>)
      default: return (<div className="schedule-config-area"><div className="empty-state" style={{ padding: '4px' }}>Dijalankan sekali saja</div></div>)
    }
  }

  /* ===== Render: Dashboard View (filter tabs + manual filters + task tree) ===== */
  const renderDashboard = () => {
    // Build filtered project list based on dashFilterProject
    const filteredProjects = dashFilterProject
      ? (dashFilterProject === '__no_project__' ? [] : projects.filter(p => p.id === dashFilterProject))
      : sortedProjects
    const showNoProj = !dashFilterProject || dashFilterProject === '__no_project__'

    // Filter tasks using dashFilterQuery (local search, separate from global)
    const dashFilterTasks = (pt: Task[], projectName: string) => {
      const base = activeTab === 'selesai' ? pt : getActiveTasks(pt)
      return base.filter(t => {
        if (activeTab !== 'all' && t.status !== activeTab) return false
        if (dashFilterQuery.trim()) {
          const q = dashFilterQuery.toLowerCase()
          return t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q) || projectName.toLowerCase().includes(q)
        }
        return true
      })
    }

    // Badge counts respect project filter
    const getFilteredTasks = (status: string) => {
      const pool = dashFilterProject
        ? (dashFilterProject === '__no_project__' ? tasks.filter(t => !t.project) : tasks.filter(t => t.project?.id === dashFilterProject))
        : tasks
      if (status === 'selesai') return getActiveTasks(pool).filter(t => t.status === 'selesai').length
      return getActiveTasks(pool).filter(t => t.status === status).length
    }
    const badgeAll = dashFilterProject
      ? getFilteredTasks('siap') + getFilteredTasks('cooldown') + getFilteredTasks('selesai')
      : activeTasks.length
    const badgeSiap = getFilteredTasks('siap')
    const badgeCd = getFilteredTasks('cooldown')
    const badgeDone = getFilteredTasks('selesai')

    // Count matches for the active filter
    const totalCount = filteredProjects.reduce((sum, p) => sum + dashFilterTasks(tasks.filter(t => t.project?.id === p.id), p.name).length, 0)
    const noProjCount = showNoProj ? dashFilterTasks(tasks.filter(t => !t.project), 'Tanpa Project').length : 0
    const visibleCount = totalCount + noProjCount

    return (
      <div>
        {/* Filter bar: status tabs + search + project dropdown — all in one row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 6px', background: '#d4d0c8', borderBottom: '1px solid #808080', flexWrap: 'wrap' }}>
          <button className={`win95-toolbar-btn`} style={{ border: activeTab === 'all' ? '1px inset' : '1px solid transparent', fontSize: 11 }} onClick={() => { setActiveTab('all'); setDashFilterQuery('') }}>📋 Semua <span className="filter-count">({badgeAll})</span></button>
          <button className={`win95-toolbar-btn`} style={{ border: activeTab === 'siap' ? '1px inset' : '1px solid transparent', fontSize: 11 }} onClick={() => { setActiveTab('siap'); setDashFilterQuery('') }}>✅ Siap <span className="filter-count" style={{ color: 'var(--win95-siap)' }}>({badgeSiap})</span></button>
          <button className={`win95-toolbar-btn`} style={{ border: activeTab === 'cooldown' ? '1px inset' : '1px solid transparent', fontSize: 11 }} onClick={() => { setActiveTab('cooldown'); setDashFilterQuery('') }}>⏳ CD <span className="filter-count" style={{ color: 'var(--win95-cd)' }}>({badgeCd})</span></button>
          <button className={`win95-toolbar-btn`} style={{ border: activeTab === 'selesai' ? '1px inset' : '1px solid transparent', fontSize: 11 }} onClick={() => { setActiveTab('selesai'); setDashFilterQuery('') }}>✔️ Done <span className="filter-count">({badgeDone})</span></button>
          <input type="text" className="win95-input" placeholder="Cari task... (F)" value={dashFilterQuery} onChange={e => { setDashFilterQuery(e.target.value); setSearchQuery(e.target.value) }} id="search-input" style={{ flex: 1, minWidth: 100, fontSize: 11 }} />
          <div className="win95-toolbar-sep" />
          <select className="win95-select" value={dashFilterProject || ''} onChange={e => setDashFilterProject(e.target.value || null)} style={{ fontSize: 11, minWidth: 130 }}>
            <option value="">📋 Semua Project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            {tasks.some(t => !t.project) && <option value="__no_project__">📎 Tanpa Project</option>}
          </select>
          {dashFilterProject && <button className="win95-btn" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => setDashFilterProject(null)}>✕</button>}
          <span style={{ fontSize: 10, color: '#808080', userSelect: 'none' }}>{visibleCount} task</span>
        </div>
        {/* Task tree content */}
        {projects.length === 0 && !tasks.some(t => !t.project) ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <div className="icon">📂</div>
            <div style={{ marginBottom: 8, fontWeight: 'bold' }}>Belum ada project</div>
            <div>Buat project untuk mengelompokkan task, atau langsung buat task baru</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="win95-btn primary" onClick={openAddProject}>📁 Buat Project</button>
              <button className="win95-btn" onClick={openAddStandalone}>📌 Task Baru</button>
            </div>
          </div>
        ) : (
          <>
            {/* Always show project folders even when they have 0 tasks */}
            {filteredProjects.map(renderFolder)}
            {/* Show "no tasks" message below folders if no tasks found */}
            {visibleCount === 0 && !dashFilterQuery && filteredProjects.length > 0 && (
              <div className="empty-state" style={{ padding: '8px 16px' }}>
                <div style={{ fontSize: 10, color: '#808080' }}>📭 Tidak ada task {filterLabel} — klik + pada folder untuk menambahkan</div>
              </div>
            )}
            {/* Folder for tasks without project */}
            {showNoProj && (() => {
              const noProjTasks = tasks.filter(t => !t.project)
              if (noProjTasks.length === 0) return null
              const activeNoProjTasks = getActiveTasks(noProjTasks)
              const fakeProject: Project = { id: '__no_project__', name: 'Tanpa Project', color: '#808080', _count: { tasks: activeNoProjTasks.length } }
              const savedId = fakeProject.id
              const savedExpanded = expandedProjects.has(savedId)
              const pt = noProjTasks
              const filtered = dashFilterTasks(pt, 'Tanpa Project')
              const fSiap = filtered.filter(t => t.status === 'siap')
              const fCd = filtered.filter(t => t.status === 'cooldown')
              const fDone = filtered.filter(t => t.status === 'selesai')
              if (dashFilterQuery.trim() && filtered.length === 0) return null
              const shouldExpand = dashFilterQuery.trim() ? filtered.length > 0 : (savedExpanded || dashFilterQuery.trim())
              return (
                <div key="__no_project__" className="tree-folder">
                  <div className="tree-folder-header">
                    <span className={`tree-toggle ${shouldExpand ? '' : 'collapsed'}`} onClick={() => toggleFolder('__no_project__')}>
                      {shouldExpand ? '📂' : '📁'}
                    </span>
                    <div className="tree-folder-color" style={{ background: '#808080', opacity: 0.5 }} />
                    <span className="tree-folder-name" onClick={() => toggleFolder('__no_project__')} style={{ flex: 1, opacity: 0.7 }}>
                      Tanpa Project
                    </span>
                    <span className="tree-stat tree-task-count">{activeNoProjTasks.length} task</span>
                    <button className="tree-add-btn" onClick={() => openAdd('__no_project__')} title="Tambah Task">+</button>
                  </div>
                  {shouldExpand && (
                    <div className="tree-folder-content">
                      {filtered.length === 0 ? (
                        <div className="empty-state" style={{ padding: '12px 16px 8px' }}>
                          <div style={{ fontSize: 10 }}>Tidak ditemukan</div>
                        </div>
                      ) : activeTab === 'all' ? (
                        <>
                          {renderStatusGroup('✅ SIAP', fSiap, `siap-noproj`, 'var(--win95-siap)')}
                          {renderStatusGroup('⏳ COOLDOWN', fCd, `cd-noproj`, 'var(--win95-cd)')}
                          {renderStatusGroup('✔️ SELESAI', fDone, `done-noproj`, '#808080')}
                        </>
                      ) : (
                        <div className="tree-status-content">
                          {sortTasksByPriorityAndPin(filtered).map(renderRow)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
          </>
        )}
      </div>
    )
  }

  /* ===== Render: Monitor View ===== */
  const renderMonitor = () => {
    // Stats: use activeDone for progress (excludes archived sekali), totalDone for stat card
    // Ensure percentages don't exceed 100%
    const pctDone = activeTasks.length > 0 ? Math.min(100, Math.round((activeDone / activeTasks.length) * 100)) : 0
    const pctCd = activeTasks.length > 0 ? Math.min(100 - pctDone, Math.round((totalCd / activeTasks.length) * 100)) : 0
    const pctSiap = activeTasks.length > 0 ? Math.min(100 - pctDone - pctCd, Math.round((totalSiap / activeTasks.length) * 100)) : 0

    // Ready now tasks (sorted by pinned first)
    const readyTasks = sortTasksByPriorityAndPin(tasks.filter(t => t.status === 'siap'))

    // Upcoming cooldowns (sorted by soonest)
    const upcoming = tasks.filter(t => t.status === 'cooldown').sort((a, b) => a.cooldownMs - b.cooldownMs).slice(0, 10)

    // Project progress — BUG-FIX: hanya tampilkan project yang punya task
    const projectProgress = sortedProjects.map(p => {
      const s = getProjectStats(p.id)
      return { ...p, ...s, pct: s.total > 0 ? Math.round((s.done / s.total) * 100) : 0 }
    }).filter(p => p.total > 0)

    // Recently completed (tasks with lastCompletedAt, sorted newest first, exclude archived sekali)
    const recentDone = activeTasks.filter(t => t.status === 'selesai' && t.lastCompletedAt).sort((a, b) =>
      new Date(b.lastCompletedAt!).getTime() - new Date(a.lastCompletedAt!).getTime()
    ).slice(0, 8)

    return (
      <div className="dashboard-view">
        {/* Overview Cards */}
        <fieldset className="win95-group">
          <legend>📊 Ringkasan</legend>
          <div className="dashboard-stats">
            <div className="dash-stat-card">
              <div className="dash-stat-num" style={{ color: 'var(--win95-title)' }}>{projects.length}</div>
              <div className="dash-stat-label">Campaign</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num">{activeTasks.length}</div>
              <div className="dash-stat-label">Aktif</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num" style={{ color: 'var(--win95-siap)' }}>{totalSiap}</div>
              <div className="dash-stat-label">Siap Kerjakan</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num" style={{ color: 'var(--win95-cd)' }}>{totalCd}</div>
              <div className="dash-stat-label">Cooldown</div>
            </div>
            <div className="dash-stat-card">
              <div className="dash-stat-num" style={{ color: '#808080' }}>{totalDone}</div>
              <div className="dash-stat-label">Selesai</div>
            </div>
          </div>
        </fieldset>

        {/* Progress Bar */}
        <fieldset className="win95-group">
          <legend>📈 Progress Keseluruhan</legend>
          <div className="dash-progress-section">
            <div className="dash-progress-bar-track">
              <div className="dash-progress-fill-done" style={{ width: `${pctDone}%` }} />
              <div className="dash-progress-fill-cd" style={{ width: `${pctCd}%`, left: `${pctDone}%` }} />
              <div className="dash-progress-fill-siap" style={{ width: `${pctSiap}%`, left: `${pctDone + pctCd}%` }} />
            </div>
            <div className="dash-progress-legend">
              <span style={{ color: 'var(--win95-siap)' }}>■ Siap {pctSiap}%</span>
              <span style={{ color: 'var(--win95-cd)' }}>■ CD {pctCd}%</span>
              <span style={{ color: '#808080' }}>■ Done {pctDone}%</span>
            </div>
          </div>
        </fieldset>

        {/* Ready Now */}
        <fieldset className="win95-group">
          <legend>✅ Siap Dikerjakan ({readyTasks.length})</legend>
          {readyTasks.length === 0 ? (
            <div className="dashboard-empty">Tidak ada task yang siap. Semua sudah selesai atau cooldown.</div>
          ) : (
            <div className="dash-task-list">
              {readyTasks.map(t => (
                <div key={t.id} className="dash-task-item" onClick={() => openDetail(t)} onContextMenu={e => handleCtx(e, t)} onTouchStart={e => handleTouchStart(e, t)} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}>
                  <div className="dash-folder-dot" style={{ background: t.project?.color || '#808080' }} />
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_DOT[t.priority || 'medium'] || '#DAA520', flexShrink: 0 }} />
                  <div className="dash-task-info">
                    <div className="dash-task-name">{t.name}</div>
                    <div className="dash-task-meta">{t.project?.name} &middot; {SCHEDULE_LABELS[t.scheduleType]}</div>
                  </div>
                  <button className="dash-complete-btn" onClick={e => { e.stopPropagation(); startWorking(t) }} title="Kerjakan (10d)" style={{ color: '#DAA520' }}>🔨</button>
                  <button className="dash-complete-btn" onClick={e => { e.stopPropagation(); complete(t.id) }} title="Selesai">✓</button>
                </div>
              ))}
            </div>
          )}
        </fieldset>

        {/* Upcoming Cooldowns */}
        {upcoming.length > 0 && (
          <fieldset className="win95-group">
            <legend>⏳ Cooldown Terdekat</legend>
            <div className="dash-task-list">
              {upcoming.map(t => (
                <div key={t.id} className="dash-task-item" onClick={() => openDetail(t)} onContextMenu={e => handleCtx(e, t)} onTouchStart={e => handleTouchStart(e, t)} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}>
                  <div className="dash-folder-dot" style={{ background: t.project?.color || '#808080' }} />
                  <div className="dash-task-info">
                    <div className="dash-task-name">{t.name}</div>
                    <div className="dash-task-meta">{t.project?.name}</div>
                  </div>
                  <span className="dash-cd-badge" style={{ color: t.cooldownMs < 300000 ? '#CC0000' : 'var(--win95-cd)' }}>
                    {t.cooldownMs < 300000 ? '🔴' : '⏳'} {t.cooldownRemaining}
                  </span>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {/* Per-Project Progress */}
        <fieldset className="win95-group">
          <legend>📂 Progress Per Campaign ({projectProgress.length})</legend>
          <div className="dash-project-list">
            {projectProgress.map(p => (
              <div key={p.id} className="dash-project-row" onClick={() => { setExpandedProjects(prev => new Set(prev).add(p.id)); setActiveTab('all'); setViewMode('tree') }}>
                <div className="dash-folder-dot" style={{ background: p.color }} />
                <div className="dash-project-info" style={{ flex: 1 }}>
                  <div className="dash-project-name">{p.name}</div>
                  <div className="dash-progress-bar-track dash-progress-mini">
                    <div className="dash-progress-fill-done" style={{ width: `${p.pct}%` }} />
                  </div>
                  <div className="dash-task-meta">{p.siap} siap &middot; {p.cd} cd &middot; {p.done} done</div>
                </div>
                <div className="dash-project-pct" style={{ color: p.pct === 100 ? 'var(--win95-siap)' : 'var(--win95-title)' }}>
                  {p.pct}%
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        {/* Recently Completed */}
        {recentDone.length > 0 && (
          <fieldset className="win95-group">
            <legend>✔️ Terakhir Selesai</legend>
            <div className="dash-task-list">
              {recentDone.map(t => (
                <div key={t.id} className="dash-task-item" style={{ opacity: 0.7 }} onClick={() => openDetail(t)} onContextMenu={e => handleCtx(e, t)} onTouchStart={e => handleTouchStart(e, t)} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}>
                  <div className="dash-folder-dot" style={{ background: t.project?.color || '#808080' }} />
                  <div className="dash-task-info">
                    <div className="dash-task-name">{t.name}</div>
                    <div className="dash-task-meta">{t.project?.name} &middot; {t.lastCompletedAt ? fmtDate(new Date(t.lastCompletedAt)) : ''}</div>
                  </div>
                  <span style={{ color: '#808080', fontSize: 10 }}>✓</span>
                </div>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    )
  }

  /* ===== LOGIN / REGISTER SCREEN ===== */
  if (!authenticated && !loading) return (
    <div className="mbg-desktop">
      <div className="win95-window" style={{ maxWidth: 380, margin: '80px auto 0' }}>
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
              <div className="win95-field"><label>Kode Undangan *</label><input type="text" className="win95-input" value={registerInviteCode} onChange={e => { setRegisterInviteCode(e.target.value.toUpperCase()); setAuthError('') }} placeholder="Masukkan kode undangan (8 karakter)" style={{ textTransform: 'uppercase', letterSpacing: 2, fontWeight: 'bold' }} autoFocus autoComplete="off" /></div>
              <div className="win95-field"><label>Username *</label><input type="text" className="win95-input" value={registerUsername} onChange={e => { setRegisterUsername(e.target.value); setAuthError('') }} placeholder="Minimal 3 karakter (huruf/angka/_)" autoComplete="username" /></div>
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
      <div className="win95-window">
        {/* Title Bar */}
        <div className="win95-titlebar">
          <span className="win95-titlebar-text">MBG - Airdrop Task Manager</span>
          <div style={{ display: 'flex', gap: 0, alignItems: 'center' }}>
            <button className="win95-titlebar-btn" onClick={() => { setNotesPanelOpen(!notesPanelOpen); if (!notesPanelOpen) fetchNotes() }} title="Catatan (Notepad)" style={{ marginRight: 0 }}>📝</button>
            <div style={{ position: 'relative', marginLeft: 4 }}>
              <button className="win95-titlebar-btn" onClick={e => { e.stopPropagation(); setProfileMenuOpen(!profileMenuOpen) }} title="Profil Akun">👤</button>
              {profileMenuOpen && (
                <>
                  {/* Invisible overlay: clicks here close the profile menu */}
                  <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setProfileMenuOpen(false)} onPointerDown={e => e.stopPropagation()} />
                  <div ref={profileDropRef} className="win95-dropdown" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 9999, minWidth: 180 }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                    <div className="win95-dropdown-item" style={{ cursor: 'default', opacity: 0.9, fontSize: 11, fontWeight: 'bold' }}>{authUser?.displayName || authUser?.username || 'User'}</div>
                    <div className="win95-dropdown-item" style={{ cursor: 'default', opacity: 0.5, fontSize: 10 }}>@{authUser?.username} | {projects.length} project, {activeTasks.length} aktif{totalArchived > 0 ? ` (+${totalArchived} arsip)` : ''}</div>
                    {isAdmin && <div className="win95-dropdown-item" style={{ cursor: 'default', opacity: 0.7, fontSize: 10 }}>👑 ADMIN</div>}
                    <div className="win95-dropdown-sep" />
                    <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setProfileMenuOpen(false); openSettings() }}>⚙️ Pengaturan</div>
                    <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setProfileMenuOpen(false); setDialogType('templates'); fetchTemplates() }}>📋 Template Task</div>
                    <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setProfileMenuOpen(false); setDialogType('help') }}>❓ Bantuan</div>
                    {isAdmin && (
                      <>
                        <div className="win95-dropdown-sep" />
                        <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setProfileMenuOpen(false); openAdminPanel() }} style={{ color: '#006600', fontWeight: 'bold' }}>👑 Panel Admin</div>
                      </>
                    )}
                    <div className="win95-dropdown-sep" />
                    <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); handleLogout() }} style={{ color: '#cc0000' }}>🚪 Logout</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Menu Bar */}
        <div className="win95-menubar">
          <div className="win95-menubar-item" onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === 'file' ? null : 'file') }}>
            File
            {openMenu === 'file' && (
              <div className="win95-dropdown" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); openAddProject(); setOpenMenu(null) }}>📁 Buat Project Baru</div>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); openAddStandalone(); setOpenMenu(null) }}>📌 Buat Task Baru</div>
                <div className="win95-dropdown-sep" />
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); doExport(); setOpenMenu(null) }}>Export Backup</div>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); setOpenMenu(null) }}>Import Data</div>
                <div className="win95-dropdown-sep" />
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); openImportShare(); setOpenMenu(null) }}>🔗 Import Share Code</div>
              </div>
            )}
          </div>
          <div className="win95-menubar-item" onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === 'view' ? null : 'view') }}>
            Lihat
            {openMenu === 'view' && (
              <div className="win95-dropdown" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setViewMode('dashboard'); setActiveTab('all'); setDashFilterQuery(''); setDashFilterProject(null); setOpenMenu(null) }}>📋 Dashboard</div>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setViewMode('monitor'); setActiveTab('all'); setOpenMenu(null) }}>📊 Monitor</div>
                <div className="win95-dropdown-sep" />
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setViewMode('tree'); setActiveTab('all'); setOpenMenu(null) }}>📂 Semua Task</div>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setViewMode('tree'); setActiveTab('siap'); setOpenMenu(null) }}>✅ Siap Sekarang</div>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setViewMode('tree'); setActiveTab('cooldown'); setOpenMenu(null) }}>⏳ Cooldown</div>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setViewMode('tree'); setActiveTab('selesai'); setOpenMenu(null) }}>✔️ Selesai</div>
                <div className="win95-dropdown-sep" />
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setViewMode('tree'); setExpandedProjects(new Set(projects.map(p => p.id))); setOpenMenu(null) }}>Expand Semua Folder</div>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setViewMode('tree'); setExpandedProjects(new Set()); setOpenMenu(null) }}>Collapse Semua Folder</div>
              </div>
            )}
          </div>
          <div className="win95-menubar-item" onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === 'tools' ? null : 'tools') }}>
            Alat
            {openMenu === 'tools' && (
              <div className="win95-dropdown" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setDialogType('telegram'); setOpenMenu(null) }}>Telegram</div>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); openSettings(); setOpenMenu(null) }}>Pengaturan</div>
                <div className="win95-dropdown-item" onClick={e => { e.stopPropagation(); setDialogType('templates'); fetchTemplates(); setOpenMenu(null) }}>📋 Template Task</div>
              </div>
            )}
          </div>
          <div className="win95-menubar-item" onClick={e => { e.stopPropagation(); setDialogType('help'); setOpenMenu(null) }}>
            Bantuan
          </div>
        </div>

        {/* Toolbar: Actions */}
        <div className="win95-toolbar" style={{ flexWrap: 'wrap', gap: 2 }}>
          <button className={`win95-toolbar-btn`} style={{ border: viewMode === 'dashboard' ? '1px inset' : '1px solid transparent', background: viewMode === 'dashboard' ? '#d4d0c8' : undefined }} onClick={() => { setViewMode(viewMode === 'dashboard' ? 'tree' : 'dashboard'); if (viewMode !== 'dashboard') { setActiveTab('all'); setDashFilterQuery(''); setDashFilterProject(null) } }}>📋 <span>Dashboard</span></button>
          <button className={`win95-toolbar-btn`} style={{ border: viewMode === 'monitor' ? '1px inset' : '1px solid transparent', background: viewMode === 'monitor' ? '#d4d0c8' : undefined }} onClick={() => { setViewMode(viewMode === 'monitor' ? 'tree' : 'monitor') }}>📊 <span>Monitor</span></button>
          <div className="win95-toolbar-sep" />
          <button className="win95-toolbar-btn" onClick={openAddProject} title="Buat Project Baru">📁 <span>Project Baru</span></button>
          <button className="win95-toolbar-btn" onClick={openAddStandalone} title="Buat Task Baru (tanpa project)">📌 <span>Task Baru</span></button>
          <button className="win95-toolbar-btn" onClick={() => fetchData(true)} title="Refresh (R)">🔄 <span>Refresh</span></button>
          <div className="win95-toolbar-sep" />
          <button className="win95-toolbar-btn" onClick={() => { setDialogType('templates'); fetchTemplates() }} title="Template Task">📋 <span>Template</span></button>
          <button className="win95-toolbar-btn" onClick={() => setDialogType('telegram')} title="Telegram Notifikasi" style={telegramLinked ? { color: '#008000' } : { color: '#cc0000' }}>📱 <span>Telegram{telegramLinked ? '' : ''}</span></button>
        </div>

        {/* ===== MAIN CONTENT: Tree / Dashboard / Monitor ===== */}
        <div className="win95-content">
          {viewMode === 'dashboard' ? renderDashboard() : viewMode === 'monitor' ? renderMonitor() : projects.length === 0 ? (
            <div className="empty-state" style={{ padding: 40 }}>
              <div className="icon">📂</div>
              <div style={{ marginBottom: 8, fontWeight: 'bold' }}>Belum ada project</div>
              <div>Buat project untuk mengelompokkan task, atau langsung buat task baru</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="win95-btn primary" onClick={openAddProject}>📁 Buat Project</button>
                <button className="win95-btn" onClick={openAddStandalone}>📌 Task Baru</button>
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: '#808080' }}>
                Contoh project: LayerZero, Grass, Polymarket, dll
              </div>
            </div>
          ) : (
            <>
              {sortedProjects.map(renderFolder)}
              {/* Show hint when all folders are empty */}
              {showEmptyState && (
                <div className="empty-state" style={{ padding: '8px 16px' }}>
                  <div style={{ fontSize: 10, color: '#808080' }}>📭 Tidak ada task {filterLabel} — klik + pada folder untuk menambahkan</div>
                </div>
              )}
              {/* Folder for tasks without project */}
              {(() => {
                const noProjTasks = tasks.filter(t => !t.project)
                if (noProjTasks.length === 0) return null
                /* Fix B9: Use active count for stats (exclude archived sekali) */
                const activeNoProjTasks = getActiveTasks(noProjTasks)
                const fakeProject: Project = { id: '__no_project__', name: 'Tanpa Project', color: '#808080', _count: { tasks: activeNoProjTasks.length } }
                const savedId = fakeProject.id
                const savedExpanded = expandedProjects.has(savedId)
                const pt = noProjTasks
                const filtered = filterTasks(pt, 'Tanpa Project')
                const fSiap = filtered.filter(t => t.status === 'siap')
                const fCd = filtered.filter(t => t.status === 'cooldown')
                const fDone = filtered.filter(t => t.status === 'selesai')
                if (debouncedSearch.trim() && filtered.length === 0) return null
                const shouldExpand = debouncedSearch.trim() ? filtered.length > 0 : (savedExpanded || debouncedSearch.trim())
                return (
                  <div key="__no_project__" className="tree-folder">
                    <div className="tree-folder-header">
                      <span className={`tree-toggle ${shouldExpand ? '' : 'collapsed'}`} onClick={() => toggleFolder('__no_project__')}>
                        {shouldExpand ? '📂' : '📁'}
                      </span>
                      <div className="tree-folder-color" style={{ background: '#808080', opacity: 0.5 }} />
                      <span className="tree-folder-name" onClick={() => toggleFolder('__no_project__')} style={{ flex: 1, opacity: 0.7 }}>
                        Tanpa Project
                      </span>
                      <span className="tree-stat tree-task-count">{activeNoProjTasks.length} task</span>
                      <button className="tree-add-btn" onClick={() => openAdd('__no_project__')} title="Tambah Task">+</button>
                    </div>
                    {shouldExpand && (
                      <div className="tree-folder-content">
                        {filtered.length === 0 ? (
                          <div className="empty-state" style={{ padding: '12px 16px 8px' }}>
                            <div style={{ fontSize: 10 }}>Tidak ditemukan</div>
                          </div>
                        ) : activeTab === 'all' ? (
                          <>
                            {renderStatusGroup('✅ SIAP', fSiap, `siap-noproj`, 'var(--win95-siap)')}
                            {renderStatusGroup('⏳ COOLDOWN', fCd, `cd-noproj`, 'var(--win95-cd)')}
                            {renderStatusGroup('✔️ SELESAI', fDone, `done-noproj`, '#808080')}
                          </>
                        ) : (
                          <div className="tree-status-content">
                            {sortTasksByPriorityAndPin(filtered).map(renderRow)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}
            </>
          )}
        </div>

        {/* Status bar */}
        <div className="win95-statusbar">
          <div className="win95-statusbar-section">{projects.length} folder, {activeTasks.length} aktif{totalArchived > 0 && <span style={{ color: '#808080' }}> (+{totalArchived} arsip)</span>}{searchQuery && <span style={{ color: '#000080' }}> | Cari...</span>}{globalLoading && <span className="syncing-indicator"> ⟳ sinkronisasi...</span>}</div>
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
            <div className="win95-titlebar"><span className="win95-titlebar-text">📁 Buat Project Baru</span><button className="win95-titlebar-btn" onClick={() => setDialogType(null)}>✕</button></div>
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
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar">
              <span className="win95-titlebar-text">{dialogType === 'add' ? `Tambah Task` : 'Edit Task'}</span>
              <button className="win95-titlebar-btn" onClick={() => setDialogType(null)}>✕</button>
            </div>
            <div className="win95-dialog-body">
              {/* Project indicator */}
              <div className="win95-field">
                <label>Project</label>
                {dialogType === 'add' && addDialogProject ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: '#fff', border: '2px inset', fontSize: 11 }}>
                    <span style={{ width: 12, height: 12, background: addDialogProject.color, display: 'inline-block', border: '1px solid rgba(0,0,0,0.3)' }} />
                    <span>{addDialogProject.name}</span>
                  </div>
                ) : (
                  <select className="win95-select" value={formProjectId === '__no_project__' ? '' : (formProjectId || '')} onChange={e => setFormProjectId(e.target.value || null)}>
                    <option value="">-- Tanpa Project --</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </div>
              <div className="win95-field"><label>Nama Task *</label><input type="text" className="win95-input" value={formName} onChange={e => setFormName(e.target.value)} placeholder="Contoh: Daily Claim" autoFocus onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveTask() } }} /></div>
              <div className="win95-field"><label>Deskripsi</label><textarea className="win95-textarea" rows={2} value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Detail task..." /></div>
              <div className="win95-field"><label>Link</label><input type="text" className="win95-input" value={formLink} onChange={e => setFormLink(e.target.value)} placeholder="https://..." /></div>
              <div className="win95-field"><label>Jadwal</label>
                <select className="win95-select" value={formScheduleType} onChange={e => { setFormScheduleType(e.target.value); setFormScheduleConfig({}) }}>
                  {Object.entries(SCHEDULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {renderSchedCfg()}
              {/* Feature 1: Priority selector */}
              <div className="win95-field"><label>Prioritas</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 11 }}>
                    <input type="radio" name="priority" value="high" checked={formPriority === 'high'} onChange={() => setFormPriority('high')} style={{ accentColor: '#CC0000' }} /> 🔴 Tinggi
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 11 }}>
                    <input type="radio" name="priority" value="medium" checked={formPriority === 'medium'} onChange={() => setFormPriority('medium')} style={{ accentColor: '#DAA520' }} /> 🟡 Sedang
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 11 }}>
                    <input type="radio" name="priority" value="low" checked={formPriority === 'low'} onChange={() => setFormPriority('low')} style={{ accentColor: '#228B22' }} /> 🟢 Rendah
                  </label>
                </div>
              </div>
              {/* Feature 3: Load from template */}
              {dialogType === 'add' && templates.length > 0 && (
                <div className="win95-field"><label>📌 Dari Template</label>
                  <select className="win95-select" value="" onChange={e => { if (e.target.value) { const tpl = templates.find(t => t.id === e.target.value); if (tpl) loadFromTemplate(tpl) } }} style={{ fontSize: 10 }}>
                    <option value="">-- Pilih Template --</option>
                    {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{PRIORITY_LABEL[tpl.priority || 'medium']?.split(' ')[1] || ''} {tpl.name} ({SCHEDULE_LABELS[tpl.scheduleType] || tpl.scheduleType})</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="win95-dialog-footer">
              <button className="win95-btn primary" disabled={!formName.trim() || savingTask} onClick={() => saveTask()} style={savingTask ? { opacity: 0.6, cursor: 'wait' } : {}}>{savingTask ? '⏳ Menyimpan...' : 'OK'}</button>
              <button className="win95-btn" onClick={() => setDialogType(null)}>Batal</button>
              <div style={{ flex: 1, fontSize: 9, color: '#808080', textAlign: 'right' }}>Ctrl+Enter untuk simpan</div>
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
          onDelete={() => { if (detailRef.current) { delTask(detailRef.current.id); setDialogType(null) } }}
          onTogglePin={() => { if (detailRef.current) { togglePin(detailRef.current); detailRef.current = { ...detailRef.current, pinned: !detailRef.current.pinned } } }}
          onSaveNotes={saveNotes} scheduleLabels={SCHEDULE_LABELS} autoCompleteLink={settings.autoCompleteLink}
          fmtTime={fmtTime} fmtFull={fmtFull} />
      )}

      {/* ===== SETTINGS DIALOG ===== */}
      {dialogType === 'settings' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">Pengaturan</span><button className="win95-titlebar-btn" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body">
              <div className="win95-field"><label>Timezone</label><select className="win95-select" value={formTimezone} onChange={e => setFormTimezone(e.target.value)}>{TZ_OPTIONS.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}</select></div>
              <div className="win95-field"><label>Format Jam</label><select className="win95-select" value={formTimeFormat} onChange={e => setFormTimeFormat(e.target.value as '24' | '12')}><option value="24">24 Jam (14:30)</option><option value="12">12 Jam (02:30 PM)</option></select></div>
              <fieldset className="win95-group"><legend>Perilaku</legend>
                <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" className="task-checkbox" checked={formAutoExpandSiap} onChange={e => setFormAutoExpandSiap(e.target.checked)} />
                    <span><b>Auto-buka folder</b> jika ada task siap</span>
                  </label>
                  <div style={{ fontSize: 10, color: '#808080', marginLeft: 20 }}>Folder campaign otomatis terbuka saat ada task yang siap dikerjakan</div>
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
                  <div style={{ fontSize: 10, color: '#808080', marginLeft: 20 }}>Kirim notif ke Telegram 2 menit sebelum & saat task siap</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 4 }}>
                    <input type="checkbox" className="task-checkbox" checked={formBrowserNotif} onChange={e => { setFormBrowserNotif(e.target.checked); if (e.target.checked) requestNotifPermission() }} />
                    <span><b>🔔 Push Notifikasi</b> (seperti Discord)</span>
                  </label>
                  <div style={{ fontSize: 10, color: '#808080', marginLeft: 20 }}>Notif muncul di pojok kanan bawah walau app sedang dibuka app lain</div>
                  {notifPermission !== 'granted' && formBrowserNotif && (
                    <div style={{ fontSize: 10, color: '#cc0000', marginLeft: 20, marginTop: 2 }}>Izin browser dibutuhkan. Klik checkbox untuk mengizinkan.</div>
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
                <div>{projects.length} project, {activeTasks.length} aktif (Siap: {totalSiap} | CD: {totalCd} | Done: {totalDone}){totalArchived > 0 && <span> | Arsip: {totalArchived}</span>}</div>
                <div>Telegram: {telegramLinked ? `Terhubung (${telegramName})` : 'Belum'}</div>
              </div></fieldset>
              <fieldset className="win95-group"><legend>Shortcuts</legend><div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.6 }}>
                <div><b>R</b> Refresh | <b>F</b> Cari | <b>N</b> Tambah | <b>D</b> Monitor | <b>Esc</b> Tutup</div>
                <div><b>1-4</b> Tab Filter | <b>?</b> Bantuan | <b>Ctrl+Enter</b> Simpan task</div>
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
            <div className="win95-titlebar"><span className="win95-titlebar-text">Edit Project</span><button className="win95-titlebar-btn" onClick={() => setDialogType(null)}>✕</button></div>
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
      {dialogType === 'telegram' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">📱 Telegram</span><button className="win95-titlebar-btn" onClick={() => setDialogType(null)}>✕</button></div>
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
          <div className="win95-dialog move-dialog" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">📦 Pindah Task</span><button className="win95-titlebar-btn" onClick={() => setMoveDialogTask(null)}>✕</button></div>
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
      {confirmData && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => { if (!confirmLoading) setConfirmData(null) }}>
          <div className="win95-dialog" role="dialog" aria-modal="true" style={{ maxWidth: 350 }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">{confirmData.title}</span>{!confirmLoading && <button className="win95-titlebar-btn" onClick={() => setConfirmData(null)}>✕</button>}</div>
            <div className="win95-dialog-body" style={{ display: 'flex', alignItems: 'flex-start' }}><span className="win95-confirm-icon">⚠️</span><span className="win95-confirm-text">{confirmData.message}</span></div>
            <div className="win95-dialog-footer">
              <button className="win95-btn primary" disabled={confirmLoading} onClick={confirmData.onConfirm} style={confirmLoading ? { opacity: 0.6, cursor: 'wait' } : {}}>
                {confirmLoading ? '⏳ Menghapus...' : 'Ya'}
              </button>
              <button className="win95-btn" disabled={confirmLoading} onClick={() => { if (!confirmLoading) setConfirmData(null) }}>Tidak</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TASK CONTEXT MENU (Fix #1: clamped, Fix #8: duplicate, Fix #9: move) ===== */}
      {contextMenu && (
        <div ref={taskCtxRef} className="win95-context-menu" style={{ left: contextMenu.x, top: contextMenu.y, zIndex: 6000 }}>
          <div className="win95-context-item" onClick={() => { openDetail(contextMenu.task); setContextMenu(null) }}>📋 Detail</div>
          <div className="win95-context-item" onClick={() => { openEdit(contextMenu.task); setContextMenu(null) }}>✏️ Edit</div>
          {contextMenu.task.status === 'siap' && <div className="win95-context-item" onClick={() => { startWorking(contextMenu.task); setContextMenu(null) }}>🔨 Kerjakan</div>}
          {contextMenu.task.status === 'siap' && <div className="win95-context-item" onClick={() => { complete(contextMenu.task.id); setContextMenu(null) }}>✅ Selesaikan</div>}
          {contextMenu.task.status !== 'siap' && contextMenu.task.scheduleType !== 'sekali' && contextMenu.task.scheduleType !== 'tanggal_spesifik' && <div className="win95-context-item" onClick={() => { reset(contextMenu.task.id); setContextMenu(null) }}>🔄 Reset</div>}
          <div className="win95-context-item" onClick={() => { togglePin(contextMenu.task); setContextMenu(null) }}>{contextMenu.task.pinned ? '📌 Unpin' : '📌 Pin'}</div>
          {contextMenu.task.link && (
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
            <div className="win95-titlebar"><span className="win95-titlebar-text">🔗 Share Project</span><button className="win95-titlebar-btn" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body">
              {!shareCode ? (
                <>
                  <div style={{ marginBottom: 8 }}>Share project <b>"{shareProjectName}"</b> dengan teman?</div>
                  <div className="win95-field">
                    <label>Task yang akan di-share: semua task di project ini</label>
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
            <div className="win95-titlebar"><span className="win95-titlebar-text">📥 Import Share Code</span><button className="win95-titlebar-btn" onClick={() => setDialogType(null)}>✕</button></div>
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
          <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} style={{ maxWidth: 500, maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">📋 Template Task</span><button className="win95-titlebar-btn" onClick={() => setDialogType(null)}>✕</button></div>
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
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: PRIORITY_DOT[tpl.priority || 'medium'] || '#DAA520', flexShrink: 0 }} />
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
          <div className="win95-context-item" onClick={() => { toggleFolder(projectContextMenu.project.id); setProjectContextMenu(null) }}>
            {expandedProjects.has(projectContextMenu.project.id) ? '📁 Collapse' : '📂 Expand'}
          </div>
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

      {/* ===== HELP DIALOG ===== */}
      {dialogType === 'help' && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog help-dialog" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar"><span className="win95-titlebar-text">📖 Petunjuk Penggunaan</span><button className="win95-titlebar-btn" onClick={() => setDialogType(null)}>✕</button></div>
            <div className="win95-dialog-body help-body">
              <div className="help-section">
                <div className="help-section-title">📁 Project / Campaign</div>
                <div className="help-item"><span className="help-key">File → Buat Project Baru</span> Membuat folder campaign baru (contoh: LayerZero, Grass)</div>
                <div className="help-item"><span className="help-key">Klik kanan folder</span> Buka context menu: Tambah Task, Complete Semua, Edit, Hapus</div>
                <div className="help-item"><span className="help-key">Klik ikon folder</span> Buka/tutup folder untuk melihat task di dalamnya</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">✅ Task</div>
                <div className="help-item"><span className="help-key">📌 Task Baru</span> Buat task langsung tanpa project (toolbar / File menu / shortcut T)</div>
                <div className="help-item"><span className="help-key">Tombol [+] di folder</span> Tambah task baru ke campaign tersebut</div>
                <div className="help-item"><span className="help-key">Checkbox ☑</span> Klik untuk selesaikan/reset task</div>
                <div className="help-item"><span className="help-key">Klik task</span> Buka detail task (catatan, info lengkap)</div>
                <div className="help-item"><span className="help-key">Klik kanan task</span> Context menu: Kerjakan, Edit, Duplikat, Pin, Pindah, Hapus</div>
                <div className="help-item"><span className="help-key">Tombol 🔨 Kerjakan</span> Buka link + timer 10 detik, otomatis selesai. Bisa batalkan/undo</div>
                <div className="help-item"><span className="help-key">Ikon 🔗</span> Buka link task. Jika auto-selesaikan aktif, otomatis ditandai selesai</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">⏰ Jadwal & Cooldown</div>
                <div className="help-item"><span className="help-key">Sekali</span> Dijalankan satu kali saja</div>
                <div className="help-item"><span className="help-key">Harian</span> Selesai → cooldown → siap lagi besok (sesuai jam cooldown)</div>
                <div className="help-item"><span className="help-key">Mingguan</span> Siap di hari tertentu setiap minggu</div>
                <div className="help-item"><span className="help-key">Jam Tertentu</span> Siap di jam-jam yang ditentukan (09:00, 15:00, dll)</div>
                <div className="help-item"><span className="help-key">Tgl Spesifik</span> Siap di tanggal tertentu</div>
                <div className="help-item"><span className="help-key">Kustom</span> Cooldown manual (bebas atur jam)</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">🔴 Prioritas Task</div>
                <div className="help-item">Setiap task punya prioritas: Tinggi (🔴), Sedang (🟡), Rendah (🟢)</div>
                <div className="help-item">Task diprioritaskan otomatis berdasarkan tinggi → sedang → rendah</div>
                <div className="help-item"><span className="help-key">Tombol bulat</span> di task menunjukkan warna prioritas</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">📋 Dashboard</div>
                <div className="help-item"><span className="help-key">Lihat → Dashboard</span> Atau klik tombol 📋 di toolbar / tekan 1-4</div>
                <div className="help-item">View dengan filter tabs untuk memfilter task: Semua, Siap, CD, Done</div>
                <div className="help-item">Task tree ditampilkan sesuai filter yang aktif</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">📊 Monitor</div>
                <div className="help-item"><span className="help-key">Lihat → Monitor</span> Atau klik tombol 📊 di toolbar / tekan D</div>
                <div className="help-item">Melihat ringkasan: total campaign, task siap, cooldown, progress per campaign</div>
                <div className="help-item">Klik campaign di monitor untuk langsung buka folder-nya</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">⚙️ Pengaturan</div>
                <div className="help-item"><span className="help-key">Alat → Pengaturan</span> Atur timezone, perilaku auto-expand, auto-selesaikan link</div>
                <div className="help-item"><span className="help-key">Auto-buka folder</span> Folder otomatis terbuka kalau ada task siap</div>
                <div className="help-item"><span className="help-key">Auto-selesaikan</span> Task otomatis selesai saat link diklik</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">⌨️ Shortcut Keyboard</div>
                <div className="help-item"><span className="help-key">R</span> Refresh data</div>
                <div className="help-item"><span className="help-key">F / /</span> Fokus ke kolom pencarian</div>
                <div className="help-item"><span className="help-key">D</span> Toggle Monitor</div>
                <div className="help-item"><span className="help-key">N</span> Tambah task baru (ke folder yang expanded, atau standalone)</div>
                <div className="help-item"><span className="help-key">T</span> Tambah task baru tanpa project</div>

                <div className="help-item"><span className="help-key">1/2/3/4</span> Dashboard filter (Semua/Siap/CD/Done)</div>
                <div className="help-item"><span className="help-key">?</span> Buka dialog bantuan</div>
                <div className="help-item"><span className="help-key">Ctrl+Enter</span> Simpan task (di dialog tambah/edit)</div>
                <div className="help-item"><span className="help-key">Esc</span> Tutup dialog/menu</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">🔔 Notifikasi Cooldown</div>
                <div className="help-item">Atur di Pengaturan: berapa menit sebelum cooldown selesai, notifikasi muncul</div>
                <div className="help-item">Mendukung notifikasi browser/Windows dan suara beep</div>
                <div className="help-item">Default: 5 menit sebelum task siap</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">📋 Template Task</div>
                <div className="help-item">Simpan task yang sering digunakan sebagai template</div>
                <div className="help-item"><span className="help-key">Alat → Template Task</span> Kelola template</div>
                <div className="help-item"><span className="help-key">📌 Dari Template</span> Muat template saat tambah task baru</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">📱 Telegram</div>
                <div className="help-item">Hubungkan akun MBG ke Telegram untuk notifikasi.</div>
                <div className="help-item"><span className="help-key">Alat → Telegram → Generate Kode</span> Buat kode koneksi</div>
                <div className="help-item"><span className="help-key">/start &lt;kode&gt;</span> Kirim kode ke bot Telegram</div>
              </div>

              <div className="help-section">
                <div className="help-section-title">💡 Tips</div>
                <div className="help-item">📌 Pin task penting agar selalu tampil di atas</div>
                <div className="help-item">🔧 Klik kanan folder → Complete Semua Siap untuk batch complete</div>
                <div className="help-item">📦 Pindahkan task antar campaign via context menu</div>
                <div className="help-item">📄 Duplikat task untuk membuat task serupa dengan cepat</div>
                <div className="help-item">💾 Export/Import backup data di menu File</div>

              </div>
            </div>
            <div className="win95-dialog-footer"><button className="win95-btn primary" onClick={() => setDialogType(null)}>OK</button></div>
          </div>
        </div>
      )}

      {/* ===== ADMIN PANEL DIALOG ===== */}
      {dialogType === 'admin' && isAdmin && (
        <div className="win95-dialog-overlay" role="presentation" onClick={() => setDialogType(null)}>
          <div className="win95-dialog" role="dialog" aria-modal="true" style={{ maxWidth: 700, width: '95vw', maxHeight: '85vh' }} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <div className="win95-titlebar">
              <span className="win95-titlebar-text">👑 Panel Admin</span>
              <button className="win95-titlebar-btn" onClick={() => setDialogType(null)}>✕</button>
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
        <div style={{ position: 'fixed', top: 0, right: 0, width: 320, height: '100vh', zIndex: 5000, display: 'flex', flexDirection: 'column' }}>
          <div className="win95-window" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="win95-titlebar">
              <span className="win95-titlebar-text">📝 Catatan</span>
              <button className="win95-titlebar-btn" onClick={() => setNotesPanelOpen(false)}>✕</button>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {['#FFFFCC', '#FFCCCC', '#CCFFCC', '#CCE5FF', '#E5CCFF', '#FFE5CC', '#FFFFFF'].map(c => (
                  <div key={c} onClick={() => setNoteFormColor(c)}
                    style={{ width: 18, height: 18, background: c, border: noteFormColor === c ? '2px solid #000' : '1px solid #808080', cursor: 'pointer', flexShrink: 0 }} />
                ))}
                <div style={{ flex: 1 }} />
                {editingNoteId && <button className="win95-btn" style={{ fontSize: 10, padding: '1px 8px' }} onClick={() => { setEditingNoteId(null); setNoteFormContent(''); setNoteFormColor('#FFFFCC') }}>Batal</button>}
                <button className="win95-btn primary" style={{ fontSize: 10, padding: '1px 8px' }} onClick={saveNote}>{editingNoteId ? 'Simpan' : 'Tambah'}</button>
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
        return <div key={t.id} className={`win95-toast ${cls}`}>{icon} {t.msg}</div>
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
function DetailDialog({ task, onClose, onEdit, onComplete, onReset, onDelete, onTogglePin, onSaveNotes, scheduleLabels, autoCompleteLink, fmtTime, fmtFull }: {
  task: Task; onClose: () => void; onEdit: () => void; onComplete: () => void; onReset: () => void
  onDelete: () => void; onTogglePin: () => void; onSaveNotes: (id: string, notes: string) => void; scheduleLabels: Record<string, string>
  autoCompleteLink?: boolean; fmtTime: (d: Date) => string; fmtFull: (d: Date) => string
}) {
  const [notes, setNotes] = useState(task.notes || '')
  // Sync notes state jika task.notes berubah dari luar (misal fetchData refresh)
  useEffect(() => { setNotes(task.notes || '') }, [task.notes]) // eslint-disable-line react-hooks/set-state-in-effect
  const [saved, setSaved] = useState('')
  const blur = () => { if (notes !== (task.notes || '')) { onSaveNotes(task.id, notes); setSaved(fmtTime(new Date())) } }
  const sc = task.status === 'siap' ? 'var(--win95-siap)' : task.status === 'cooldown' ? 'var(--win95-cd)' : 'var(--win95-done)'
  const sl = task.status === 'siap' ? '✅ Siap Sekarang' : task.status === 'cooldown' ? '⏳ Cooldown' : '✔️ Selesai'

  return (
    <div className="win95-dialog-overlay" role="presentation" onClick={onClose}>
      <div className="win95-dialog" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="win95-titlebar"><span className="win95-titlebar-text">📋 {task.name}</span><button className="win95-titlebar-btn" onClick={onClose}>✕</button></div>
        <div className="win95-dialog-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontWeight: 'bold', color: sc, fontSize: 12 }}>{sl}</span>
            {task.pinned && <span style={{ fontSize: 10 }}>📌</span>}
          </div>
          <fieldset className="win95-group"><legend>Info</legend>
            <div style={{ padding: '4px 8px', fontSize: 11, lineHeight: 1.8 }}>
              {task.project && <div style={{ display: 'flex', gap: 6 }}><span style={{ color: '#808080', minWidth: 60 }}>Project:</span><span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, background: task.project.color, border: '1px solid rgba(0,0,0,0.3)', display: 'inline-block' }} />{task.project.name}</span></div>}
              <div style={{ display: 'flex', gap: 6 }}><span style={{ color: '#808080', minWidth: 60 }}>Jadwal:</span><span>{scheduleLabels[task.scheduleType]}</span></div>
              {task.status === 'cooldown' && task.cooldownRemaining && <div style={{ display: 'flex', gap: 6 }}><span style={{ color: '#808080', minWidth: 60 }}>Cooldown:</span><span style={{ color: 'var(--win95-cd)', fontWeight: 'bold' }}>{task.cooldownMs < 300000 ? '🔴 ' : '⏳ '}{task.cooldownRemaining}{task.nextReadyAt && <span style={{ fontWeight: 'normal', color: '#808080', marginLeft: 4 }}>({fmtTime(new Date(task.nextReadyAt))})</span>}</span></div>}
              {task.scheduleType === 'tanggal_spesifik' && task.status !== 'selesai' && task.nextReadyAt && <div style={{ display: 'flex', gap: 6 }}><span style={{ color: '#808080', minWidth: 60 }}>Tgl Target:</span><span style={{ color: 'var(--win95-siap)', fontWeight: 'bold' }}>{fmtFull(new Date(task.nextReadyAt))}</span></div>}
              {task.lastCompletedAt && <div style={{ display: 'flex', gap: 6 }}><span style={{ color: '#808080', minWidth: 60 }}>Terakhir:</span><span>{fmtFull(new Date(task.lastCompletedAt))}</span></div>}
              {task.link && <div style={{ display: 'flex', gap: 6 }}><span style={{ color: '#808080', minWidth: 60 }}>Link:</span><a href={task.link} target="_blank" rel="noopener" style={{ color: '#0000ff', textDecoration: 'underline' }} onClick={e => e.stopPropagation()}>Buka ↗</a></div>}
              <div style={{ display: 'flex', gap: 6 }}><span style={{ color: '#808080', minWidth: 60 }}>Dibuat:</span><span>{fmtFull(new Date(task.createdAt))}</span></div>
            </div>
          </fieldset>
          {task.description && <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.5, padding: '4px 8px', background: '#fff', border: '1px solid #808080' }}>{task.description}</div>}
          <div style={{ marginTop: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 'bold', marginBottom: 2, display: 'block' }}>Catatan {saved && <span style={{ fontWeight: 'normal', color: '#808080' }}>({saved})</span>}</label>
            <textarea className="win95-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} onBlur={blur} placeholder="Catatan..." />
          </div>
        </div>
        <div className="win95-dialog-footer" style={{ flexWrap: 'wrap', gap: 4 }}>
          {task.status === 'siap' && <button className="win95-btn primary" onClick={onComplete}>✅ Selesai</button>}
          {task.status !== 'siap' && task.scheduleType !== 'sekali' && task.scheduleType !== 'tanggal_spesifik' && <button className="win95-btn" onClick={onReset}>🔄 Reset</button>}
          <button className="win95-btn" onClick={onTogglePin}>{task.pinned ? '📌 Unpin' : '📌 Pin'}</button>
          {task.link && <button className="win95-btn" onClick={() => {
            if (autoCompleteLink && task.status === 'siap') {
              onComplete()
            }
            window.open(task.link!, '_blank', 'noopener,noreferrer')
          }}>🔗 {autoCompleteLink && task.status === 'siap' ? 'Buka + Selesaikan' : 'Buka'}</button>}
          <button className="win95-btn" onClick={onEdit}>✏️ Edit</button>
          <button className="win95-btn" style={{ color: '#cc0000' }} onClick={onDelete}>🗑️ Hapus</button>
        </div>
      </div>
    </div>
  )
}
