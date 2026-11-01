/**
 * Web half of `dsh-plugin-prompt-tips` — 「Prompt 小精灵」.
 *
 * Renders a floating sprite in the Harness shell overlay plus a speech-bubble
 * card: the hour's recommended prompt (verbatim from the resource library,
 * one-tap copy), why it is worth learning (model-personalised when available,
 * the library's own pre-written reason otherwise — labelled honestly), and the
 * official source. ‹ › walks the history (server caps it at 10), and buttons
 * cover the rest of the spec: 捞一条 / 同步 / 换肤.
 *
 * Everything shown comes from `/api/dsh-prompt-tips.state`; a dropped poll
 * keeps the last good snapshot on screen.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-prompt-tips',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    const API = {
      state: '/api/dsh-prompt-tips.state',
      pick: '/api/dsh-prompt-tips.pick',
      dismiss: '/api/dsh-prompt-tips.dismiss',
      asset: '/api/dsh-prompt-tips.asset',
      skin: '/api/dsh-prompt-tips.skin',
      sync: '/api/dsh-prompt-tips.sync',
    };
    const POLL_MS = 20000;
    const POLL_BUSY_MS = 3000;
    const POS_KEY = 'dsh-prompt-tips.pos';
    const PET_H = 132;
    const VENDOR_LABEL = { openai: 'OpenAI', anthropic: 'Anthropic' };

    // 内联 SVG 图标（stroke 跟随 currentColor，自动随主题/悬停变色）：
    // 更新=双箭头循环（feather refresh-cw），换肤=小衣服（lucide shirt）。
    // 中文语义只留在 title/aria-label，按钮本体不再渲染文字。
    const ICO = {
      viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none',
      stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true,
    };
    const iconSync = (spin) => h('svg', { ...ICO, 'data-spin': spin ? 'on' : 'off' },
      h('polyline', { points: '23 4 23 10 17 10' }),
      h('polyline', { points: '1 20 1 14 7 14' }),
      h('path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' }));
    const iconSkin = () => h('svg', ICO,
      h('path', { d: 'M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z' }));

    // 「星尘紫罗兰」：卡片是一片夜空——深紫底、星尘高光、皮肤 accent 做点缀。
    // 所有样式挂在 [data-prompt-tips] 下，避免与宿主互相污染。
    const CSS = `
      [data-prompt-tips]{position:fixed;z-index:86;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#e6e2ff;font-size:13px;line-height:1.6}
      [data-prompt-tips] *{box-sizing:border-box}
      .pt-anchor{position:relative;display:flex;flex-direction:column;align-items:center}
      .pt-pet{position:relative;z-index:1;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;cursor:grab;user-select:none;transition:transform .25s ease}
      .pt-pet:active{cursor:grabbing}
      .pt-pet:hover{transform:translateY(-3px)}
      .pt-img{display:block;height:${PET_H}px;width:auto;max-width:140px;object-fit:contain;filter:drop-shadow(0 10px 16px #0a0618aa);animation:pt-sway 4.2s ease-in-out infinite}
      @keyframes pt-sway{0%,100%{transform:translateY(0) rotate(-.4deg)}50%{transform:translateY(-2.5px) rotate(.4deg)}}
      .pt-img[data-talking="on"]{animation:pt-bob 1.6s ease-in-out infinite}
      .pt-img[data-sleeping="on"]{opacity:.85;filter:saturate(.9);animation:none}
      @media (prefers-reduced-motion: reduce){.pt-img{animation:none !important}}
      @keyframes pt-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
      @keyframes pt-spin{to{transform:rotate(360deg)}}
      .pt-nav svg{display:block}
      .pt-ico[data-spin="on"]{animation:pt-spin .9s linear infinite}
      .pt-fallback{height:${PET_H}px;width:100px;display:flex;align-items:center;justify-content:center;font-size:64px;filter:drop-shadow(0 10px 16px #0a0618aa)}
      .pt-tag{margin-top:2px;font-size:10px;font-weight:700;letter-spacing:.06em;color:#e9e2ff;background:#2a1e57d9;border:1px solid #b7a5ff33;border-radius:999px;padding:2px 8px;white-space:nowrap;backdrop-filter:blur(8px)}
      .pt-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;background:#c4b5fd;box-shadow:0 0 6px #c4b5fdaa;vertical-align:1px}
      .pt-dot[data-off="off"]{background:#fca5a5;box-shadow:0 0 6px #fca5a5aa}
      .pt-badge{position:absolute;top:-4px;right:-2px;min-width:18px;height:18px;border-radius:999px;background:#f472b6;color:#fff;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 5px;box-shadow:0 2px 8px #f472b666}
      .pt-bubble{position:absolute;z-index:2;right:calc(100% + 12px);bottom:30px;width:min(360px,calc(100vw - 32px));animation:pt-in .16s ease-out}
      @keyframes pt-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      .pt-anchor[data-side="right"] .pt-bubble{right:auto;left:calc(100% + 12px)}
      .pt-card{position:relative;display:flex;flex-direction:column;max-height:min(62vh,520px);overflow:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#a78bfa #241a4dd9;color:#efeaff;border:1px solid #4c3a8f;border-radius:14px;background:linear-gradient(155deg,#322660 0%,#291e4e 46%,#1e1638 100%);box-shadow:0 22px 54px #120a2e66,0 0 0 1px #b7a5ff14 inset}
      .pt-card::-webkit-scrollbar{width:8px;height:8px}
      .pt-card::-webkit-scrollbar-track{background:#241a4dcc;border-radius:8px}
      .pt-card::-webkit-scrollbar-thumb{background:linear-gradient(180deg,#c4b5fd,#7c5cd6);border-radius:8px;border:1px solid #241a4d}
      .pt-card::-webkit-scrollbar-thumb:hover{background:linear-gradient(180deg,#ddd3ff,#9d7ff0)}
      .pt-card::-webkit-scrollbar-corner{background:#241a4d}
      .pt-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;border-radius:13px 0 0 13px;background:var(--pt-accent,#a78bfa);opacity:.9}
      .pt-tail{position:absolute;right:-5px;bottom:38px;width:10px;height:10px;background:#4c3a8f;border-right:1px solid #4c3a8f;border-top:1px solid #4c3a8f;transform:rotate(45deg)}
      .pt-anchor[data-side="right"] .pt-tail{right:auto;left:-5px;border-right:0;border-top:0;border-left:1px solid #4c3a8f;border-bottom:1px solid #4c3a8f}
      .pt-head{display:flex;align-items:center;gap:6px;padding:9px 8px 8px 14px;border-bottom:1px solid #b7a5ff2e;cursor:grab}
      .pt-head:active{cursor:grabbing}
      .pt-state{flex:1;min-width:0;font-size:11px;font-weight:800;letter-spacing:.08em;color:#e9e2ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pt-headbtn{font-size:10.5px;font-weight:750;letter-spacing:.04em;padding:1px 6px;color:#cbbcff}
      .pt-headbtn:hover:not(:disabled){background:#ffffff14;color:#fff}
      .pt-headbtn[data-on="on"]{color:#fff;background:#ffffff1f}
      .pt-nav{border:0;background:none;color:#cbbcff;font-size:15px;line-height:1;padding:1px 5px;cursor:pointer;border-radius:4px;opacity:.85}
      .pt-nav:hover:not(:disabled){color:#fff;background:#ffffff14;opacity:1}
      .pt-nav:disabled{opacity:.3;cursor:default}
      .pt-nav:focus-visible{outline:2px solid #c4b5fd;outline-offset:2px}
      .pt-close{border:0;background:none;color:#cbbcff;font-size:16px;line-height:1;padding:2px 5px;cursor:pointer;border-radius:4px;opacity:.85}
      .pt-close:hover{color:#fff;background:#ffffff14;opacity:1}
      .pt-count{font-size:9.5px;color:#a99bd9;letter-spacing:.04em}
      .pt-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:10px 14px 11px 16px;scrollbar-width:thin;scrollbar-color:#a78bfa #241a4dd9}
      .pt-body::-webkit-scrollbar{width:8px}
      .pt-body::-webkit-scrollbar-track{background:#241a4dcc;border-radius:8px}
      .pt-body::-webkit-scrollbar-thumb{background:linear-gradient(180deg,#c4b5fd,#7c5cd6);border-radius:8px}
      .pt-title{margin:0 0 8px;font-size:14.5px;font-weight:800;color:#f4f0ff;letter-spacing:.01em}
      .pt-tags{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px}
      .pt-chip{font-size:9.5px;font-weight:700;letter-spacing:.05em;color:#d6c9ff;background:#ffffff10;border:1px solid #b7a5ff2b;border-radius:999px;padding:1px 7px}
      .pt-view{cursor:pointer;border-color:#b7a5ff33;transition:all .15s ease;font-family:inherit}
      .pt-view:hover{color:#fff;border-color:#b7a5ff88}
      .pt-view[data-on="on"]{color:#fff;border-color:var(--pt-accent,#a78bfa);background:#ffffff1f}
      /* 提示词框：边框/底色在 wrap 上，框头放「提示词」标签与中英切换，框体纯正文 */
      .pt-promptwrap{margin:0 0 8px;border:1px solid #b7a5ff30;border-radius:10px;background:#171031cc;overflow:hidden}
      .pt-prompthead{display:flex;align-items:center;gap:6px;padding:6px 11px 5px;border-bottom:1px solid #b7a5ff22}
      .pt-promptlabel{font-size:10px;font-weight:800;letter-spacing:.08em;color:#cbbcff}
      .pt-views{margin-left:auto;display:flex;gap:4px}
      .pt-prompt{position:relative;margin:0;padding:9px 11px;font-size:12.5px;color:#f0ebff;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow-y:auto;scrollbar-width:thin}
      .pt-note{margin:-2px 0 8px;font-size:11px;color:#d8cdf5}
      .pt-note b{color:#fcd34d;font-weight:750}
      .pt-prompt code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
      .pt-why{margin:0 0 8px;font-size:12.5px;color:#e2d9ff}
      .pt-why b{color:var(--pt-accent,#c4b5fd);font-weight:750}
      .pt-meta{display:flex;align-items:center;gap:6px;margin:0 0 10px;font-size:10px;color:#b3a5e0;flex-wrap:wrap}
      .pt-meta a{color:#cdbdfd;text-decoration:none}
      .pt-meta a:hover{color:#fff;text-decoration:underline}
      .pt-mode{display:inline-block;font-size:9px;font-weight:800;letter-spacing:.06em;padding:1px 6px;border-radius:4px;vertical-align:1px}
      .pt-mode[data-mode="headless"]{color:#0e2a1c;background:#86efac}
      .pt-mode[data-mode="offline"]{color:#422006;background:#fcd34d}
      .pt-foot{display:flex;align-items:center;gap:8px;margin-top:2px;padding:8px 14px 10px 16px;border-top:1px solid #b7a5ff2a;flex-wrap:wrap}
      .pt-btn{border:0;background:none;padding:2px 3px;color:#e4dcff;font:inherit;font-size:11.5px;font-weight:650;cursor:pointer;white-space:nowrap;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:#b7a5ff4d;opacity:.92}
      .pt-btn:hover:not(:disabled){color:#fff;opacity:1}
      .pt-btn:disabled{opacity:.45;cursor:default}
      .pt-btn:focus-visible{outline:2px solid #c4b5fd;outline-offset:2px}
      .pt-btn[data-primary="on"]{color:#fff}
      .pt-btn[data-copied="on"]{color:#86efac;text-decoration-color:#86efac66}
      .pt-warn{margin:8px 0 0;font-size:11px;color:#fde68a}
      .pt-toast{position:absolute;z-index:3;left:50%;transform:translateX(-50%);bottom:calc(100% + 8px);font-size:11px;font-weight:650;color:#efeaff;background:#241a4df2;border:1px solid #b7a5ff44;border-radius:999px;padding:4px 12px;white-space:nowrap;box-shadow:0 8px 24px #120a2e66;animation:pt-in .16s ease-out}
      .pt-toast[data-ok="off"]{color:#fecaca;border-color:#fca5a544}
      /* 换肤面板是 pt-card 的直属条（head 之下、body 之上），不随正文滚动——
         无论正文滚到哪里，点开换肤永远立刻可见（回归修复：此前被移进
         可滚动的 pt-body 顶部，正文一滚就"开在视野外"，用户看不到任何反应）。 */
      .pt-skins{display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px 7px 16px;border-bottom:1px solid #b7a5ff1f}
      .pt-skin{display:flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;color:#d6c9ff;background:#ffffff0d;border:1px solid #b7a5ff33;border-radius:999px;padding:2px 9px;cursor:pointer;transition:all .15s ease}
      .pt-skin:hover{color:#fff;border-color:#b7a5ff88}
      .pt-skin[data-current="on"]{color:#fff;border-color:var(--pt-accent,#a78bfa);background:#ffffff1a}
      .pt-skin:focus-visible{outline:2px solid #c4b5fd;outline-offset:2px}
      .pt-skin img{width:22px;height:22px;object-fit:contain;border-radius:6px;background:#17103188}
      .pt-swatch{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
      .pt-empty{margin:0 0 10px;font-size:12.5px;color:#cfc4f5}
    `;

    const readPos = () => {
      try {
        const raw = JSON.parse(window.localStorage.getItem(POS_KEY) || 'null');
        if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return raw;
      } catch { /* private mode etc. */ }
      return null;
    };
    const writePos = (pos) => {
      try { window.localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
    };
    const clampPos = (pos) => ({
      x: Math.max(8, Math.min(pos.x, Math.max(8, window.innerWidth - 160))),
      y: Math.max(8, Math.min(pos.y, Math.max(8, window.innerHeight - 170))),
    });

    async function getJSON(url) {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    }
    async function postJSON(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `${res.status}`);
      return payload;
    }

    const mmss = (ms) => {
      const total = Math.max(0, Math.round(ms / 1000));
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    };

    // 官方说明段落前缀：与数据治理（scripts/split-official-note.mjs）同一规则——
    // 仅段落开头匹配才拆，避免误伤正文。新气泡的 officialNote 已在数据侧拆出，
    // 旧气泡的说明段仍混在正文里，这里按段落兜底拆出（两处来源互斥不重复）。
    const NOTE_RE = /^\s*官方(?:同时)?提醒\s*[:：]|^\s*官方说明\s*[:：]|^\s*注\s*[:：]/;
    const splitOfficialNote = (text) => {
      const paras = String(text || '').split(/\n{2,}/);
      const body = [];
      const note = [];
      for (const p of paras) (NOTE_RE.test(p) ? note : body).push(p);
      return { body: body.join('\n\n'), note: note.join('\n\n') };
    };

    function Pet() {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);
      const [open, setOpen] = useState(false);
      const [pinned, setPinned] = useState(null);
      const [busy, setBusy] = useState(false);
      const [syncing, setSyncing] = useState(false);
      const [copiedId, setCopiedId] = useState(null);
      const [toast, setToast] = useState(null);
      const [showSkins, setShowSkins] = useState(false);
      // Prompt display view: 'zh' (中文翻译) | 'en' (EN 模板) — a global
      // preference, kept across ‹› page flips.
      const [promptView, setPromptView] = useState('zh');
      const [pos, setPos] = useState(readPos);
      const [clock, setClock] = useState(0);
      const [spriteBroken, setSpriteBroken] = useState(false);
      // Transient emotion: { name, until } — wins over every other frame.
      const [mood, setMood] = useState({ name: 'idle', until: 0 });
      const drag = useRef(null);
      const suppress = useRef(false);
      const seen = useRef(null);
      const autoFloor = useRef(null);
      const closedIds = useRef(new Set());
      const marked = useRef(new Set());
      const toastTimer = useRef(null);

      const history = data?.history || [];
      const latest = history[0] || null;
      const index = pinned ? history.findIndex((b) => b.id === pinned) : 0;
      const current = index >= 0 ? history[index] : (history[0] || null);
      const unread = data?.unread || 0;
      const running = data?.running || busy || syncing;
      const countdown = data?.nextRunAt ? Date.parse(data.nextRunAt) - Date.now() : NaN;
      const skin = data?.skin || null;
      const skins = data?.skins || [];

      const flash = useCallback((text, ok = true) => {
        setToast({ text, ok });
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 3200);
      }, []);

      const flashMood = useCallback((name, ms = 3000) => {
        setMood({ name, until: Date.now() + ms });
      }, []);

      // 免打扰时段 → 小精灵睡觉（quietHours 来自 snapshot）。
      const isQuietNow = (() => {
        const qh = data?.quietHours;
        if (!Array.isArray(qh) || qh.length !== 2 || qh[0] === qh[1]) return false;
        const h = new Date().getHours();
        return qh[0] < qh[1] ? h >= qh[0] && h < qh[1] : h >= qh[0] || h < qh[1];
      })();
      const emo = skin?.emo || {};
      const moodActive = mood.until > Date.now();
      // 中英切换：promptEn = 纯官方可复制提示词，promptZh = 它的 1:1 中文翻译
      // （数据治理 scripts/clean-prompts-v2.mjs）；旧数据（无拆分）退化为完整
      // prompt，切换 chips 隐藏。
      // 官方说明不是提示词本体：视图文本按段落前缀兜底拆出（新气泡在数据侧
      // 已拆为 officialNote 字段，两处来源互斥），框内只留提示词本体。
      const hasSplit = Boolean(current && (current.promptZh || current.promptEn));
      const viewRaw = !current ? ''
        : hasSplit ? (promptView === 'zh' ? (current.promptZh || '') : (current.promptEn || current.prompt || ''))
        : (current.prompt || '');
      const viewSplit = splitOfficialNote(viewRaw);
      const promptText = viewSplit.body;
      const officialNote = viewSplit.note || (current?.officialNote || current?.officialNoteEn || '');

      const refresh = useCallback(async () => {
        try {
          const next = await getJSON(API.state);
          setData(next);
          setError(null);
          return next;
        } catch (failure) {
          // Keep the last good snapshot: a dropped poll must not blank the card.
          setError(String(failure?.message || failure));
          return null;
        }
      }, []);

      // Self-rescheduling poll; hidden tabs pause, busy states poll faster.
      useEffect(() => {
        let cancelled = false;
        let handle = null;
        const loop = async () => {
          if (cancelled) return;
          if (!document.hidden) await refresh();
          handle = window.setTimeout(loop, running ? POLL_BUSY_MS : POLL_MS);
        };
        void loop();
        const onVisible = () => { if (!document.hidden) void refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
          cancelled = true;
          if (handle) window.clearTimeout(handle);
          document.removeEventListener('visibilitychange', onVisible);
        };
      }, [refresh, running]);

      // A newly generated bubble opens itself; hand-closed ones stay closed.
      useEffect(() => {
        if (!latest) return;
        const at = Date.parse(latest.at || '') || Date.now();
        if (autoFloor.current === null) autoFloor.current = at;
        if (seen.current === latest.id) return;
        seen.current = latest.id;
        if (at <= autoFloor.current) return;
        if (closedIds.current.has(latest.id)) return;
        autoFloor.current = at;
        setPinned(latest.id);
        setOpen(true);
      }, [latest?.id, latest?.at]);

      // Seeing the card marks it read; the badge dies as soon as it is open.
      useEffect(() => {
        if (!open || !current || current.read) return undefined;
        const id = current.id;
        if (marked.current.has(id)) return undefined;
        const timer = window.setTimeout(async () => {
          marked.current.add(id);
          try {
            await postJSON(API.dismiss, { id });
            setData((prev) => prev ? {
              ...prev,
              unread: Math.max(0, (prev.unread || 0) - (prev.current?.id === id ? 1 : 0)),
              history: (prev.history || []).map((b) => (b.id === id ? { ...b, read: true } : b)),
            } : prev);
          } catch { /* the next poll restores the truth */ }
        }, 600);
        return () => window.clearTimeout(timer);
      }, [open, current?.id, current?.read]);

      useEffect(() => {
        const handle = window.setInterval(() => setClock((n) => n + 1), 1000);
        return () => window.clearInterval(handle);
      }, []);

      useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
          if (event.key !== 'Escape') return;
          setOpen(false);
          setPinned(null);
          setShowSkins(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [open]);

      const dismiss = useCallback(async () => {
        const id = current?.id;
        if (id) closedIds.current.add(id);
        setOpen(false);
        setPinned(null);
        setShowSkins(false);
        try {
          await postJSON(API.dismiss, id ? { id } : {});
          setData((prev) => prev ? {
            ...prev,
            current: null,
            unread: Math.max(0, (prev.unread || 0) - 1),
            history: (prev.history || []).map((b) => (b.id === id ? { ...b, read: true } : b)),
          } : prev);
        } catch { /* the next poll restores the truth */ }
        void refresh();
      }, [current, refresh]);

      /** 需求 7：手动捞一条。 */
      const pickOne = useCallback(async () => {
        setBusy(true);
        setOpen(true);
        setShowSkins(false);
        try {
          await postJSON(API.pick, {});
          const next = await refresh();
          if (next?.history?.[0]) { setPinned(next.history[0].id); autoFloor.current = Date.parse(next.history[0].at || '') || Date.now(); }
          flash('捞到一条新的 prompt ✦');
          flashMood('surprised');
        } catch (failure) {
          setError(String(failure?.message || failure));
          flash(`捞取失败：${String(failure?.message || failure).slice(0, 80)}`, false);
        } finally {
          setBusy(false);
        }
      }, [refresh, flash]);

      /** 需求 4：点击同步 → 远端 manifest 校验后落盘。 */
      const syncNow = useCallback(async () => {
        setSyncing(true);
        setShowSkins(false);
        try {
          const result = await postJSON(API.sync, {});
          if (result?.ok) {
            flash(`已同步：${result.fromVersion || '无'} → ${result.toVersion}（${result.count} 条）`);
            flashMood('excited');
          } else {
            flash(`同步失败：${String(result?.error || '未知原因').slice(0, 80)}`, false);
            flashMood('sad');
          }
          await refresh();
        } catch (failure) {
          flash(`同步失败：${String(failure?.message || failure).slice(0, 80)}`, false);
        } finally {
          setSyncing(false);
        }
      }, [refresh, flash]);

      /** 需求 5：换肤。 */
      const setSkin = useCallback(async (id) => {
        try {
          await postJSON(API.skin, { id });
          setSpriteBroken(false);
          await refresh();
          flashMood('wave', 2000);
        } catch (failure) {
          flash(`换肤失败：${String(failure?.message || failure).slice(0, 80)}`, false);
        }
      }, [refresh, flash]);

      const copyPrompt = useCallback(async () => {
        if (!promptText) return;
        try {
          await navigator.clipboard.writeText(promptText);
          setCopiedId(current.id);
          flashMood('heart', 2000);
          window.setTimeout(() => setCopiedId((prev) => (prev === current.id ? null : prev)), 2000);
        } catch {
          flash('复制失败：浏览器剪贴板不可用', false);
        }
      }, [current, flash, flashMood, promptText]);

      const startDrag = useCallback((event) => {
        if (event.button !== 0) return;
        suppress.current = false;
        const rect = event.currentTarget.closest('[data-prompt-tips]').getBoundingClientRect();
        drag.current = { sx: event.clientX, sy: event.clientY, ox: rect.left, oy: rect.top, moved: false };
        const move = (ev) => {
          const state = drag.current;
          if (!state) return;
          const dx = ev.clientX - state.sx;
          const dy = ev.clientY - state.sy;
          if (!state.moved && Math.abs(dx) + Math.abs(dy) > 4) state.moved = true;
          if (!state.moved) return;
          setPos(clampPos({ x: state.ox + dx, y: state.oy + dy }));
        };
        const up = () => {
          const state = drag.current;
          drag.current = null;
          suppress.current = !!state?.moved;
          if (state?.moved) setPos((prev) => { if (prev) writePos(prev); return prev; });
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      }, []);

      const spriteSrc = () => {
        if (spriteBroken) return null;
        const frames = skin?.frames || {};
        if (moodActive && emo[mood.name]) return emo[mood.name];
        // 免打扰不再切睡觉帧（大姿势生成易漂移）：待机帧 + CSS 半透明打盹。
        if (syncing) return emo.thinking || frames.idle || null;
        if (busy || running) return emo.talk || frames.idle || null;
        return frames.idle || null;
      };

      const newer = index > 0;
      const older = index >= 0 && index < history.length - 1;
      const excitedNow = moodActive && (mood.name === 'excited' || mood.name === 'wave' || mood.name === 'surprised');

      const skinPanel = showSkins
        ? h('div', { className: 'pt-skins' },
          skins.map((s) => h('button', {
            key: s.id,
            type: 'button',
            className: 'pt-skin',
            'data-current': s.current ? 'on' : 'off',
            style: { '--pt-accent': s.accent },
            onClick: () => setSkin(s.id),
            title: `换成「${s.name}」`,
          },
          s.preview ? h('img', { src: s.preview, alt: '' }) : h('i', { className: 'pt-swatch', style: { background: s.accent } }),
          s.name)))
        : null;

      const card = h('div', { className: 'pt-bubble' },
        h('i', { className: 'pt-tail', 'aria-hidden': true }),
        h('section', { className: 'pt-card', 'aria-label': 'Prompt 小精灵的推荐', style: { '--pt-accent': skin?.accent || '#a78bfa' } },
          // ── head：左上角固定品牌标题，右上角固定按钮组（‹ › 更新 换肤 关闭）
          h('div', { className: 'pt-head', onMouseDown: startDrag },
            h('span', { className: 'pt-state' }, '✦ 提示词精灵'),
            history.length > 1
              ? h('span', { className: 'pt-count' }, `${(index >= 0 ? index : 0) + 1}/${history.length}`)
              : null,
            history.length > 1
              ? h('button', {
                className: 'pt-nav', type: 'button', disabled: !newer,
                onClick: () => { if (newer) setPinned(history[index - 1].id); },
                title: '更新的一条（上一条）', 'aria-label': '上一条',
              }, '‹')
              : null,
            history.length > 1
              ? h('button', {
                className: 'pt-nav', type: 'button', disabled: !older,
                onClick: () => { if (older) setPinned(history[index + 1].id); },
                title: '更早的一条（下一条）', 'aria-label': '下一条',
              }, '›')
              : null,
            h('button', {
              className: 'pt-nav pt-headbtn', type: 'button', disabled: running || syncing, onClick: syncNow,
              title: '同步最新资源库（更新）', 'aria-label': '更新',
            }, iconSync(syncing)),
            h('button', {
              className: 'pt-nav pt-headbtn', type: 'button', 'data-on': showSkins ? 'on' : 'off',
              onClick: () => setShowSkins((v) => !v), title: '换肤', 'aria-label': '换肤',
            }, iconSkin()),
            h('button', { className: 'pt-close', type: 'button', onClick: () => { setOpen(false); setPinned(null); setShowSkins(false); }, 'aria-label': '收起气泡' }, '×')),
          // ── 换肤面板：head 下固定一排，不进滚动区（点开即见）
          skinPanel,
          // ── body：中间滚动区
          h('div', { className: 'pt-body' },
            toast ? h('span', { className: 'pt-toast', 'data-ok': toast.ok ? 'on' : 'off' }, toast.text) : null,
            running ? h('p', { className: 'pt-empty' }, '小精灵正在翻资料库…') : null,
            current
              ? h(React.Fragment, null,
                h('p', { className: 'pt-title' }, current.title),
                h('div', { className: 'pt-tags' },
                  (current.tags || []).map((tag) => h('span', { key: tag, className: 'pt-chip' }, tag)),
                  h('span', {
                    className: 'pt-chip', style: { color: skin?.accent || '#c4b5fd' },
                  }, VENDOR_LABEL[current.vendor] || current.vendor || '官方')),
                // 提示词框：框头 = 「提示词」标签 + 中英切换（贴着提示词本体）；
                // 框体只有当前视图的提示词正文，官方说明一律在框外（.pt-note）。
                h('div', { className: 'pt-promptwrap' },
                  h('div', { className: 'pt-prompthead' },
                    h('span', { className: 'pt-promptlabel' }, '提示词'),
                    hasSplit ? h('span', { className: 'pt-views' },
                      h('button', {
                        type: 'button',
                        className: 'pt-chip pt-view',
                        'data-on': promptView === 'zh' ? 'on' : 'off',
                        onClick: () => setPromptView('zh'),
                        title: '只看中文翻译',
                      }, '中文翻译'),
                      h('button', {
                        type: 'button',
                        className: 'pt-chip pt-view',
                        'data-on': promptView === 'en' ? 'on' : 'off',
                        onClick: () => setPromptView('en'),
                        title: '只看英文模板原文（可直接复制使用）',
                      }, 'EN 模板'))
                      : null),
                  h('pre', { className: 'pt-prompt' }, h('code', null, promptText))),
                officialNote
                  ? h('p', { className: 'pt-note' }, h('b', null, '官方说明 '), officialNote)
                  : null,
                h('p', { className: 'pt-why' }, h('b', null, '为什么值得抄 '), current.why),
                h('p', { className: 'pt-meta' },
                  h('span', {
                    className: 'pt-mode',
                    'data-mode': current.mode === 'headless' ? 'headless' : 'offline',
                    title: current.mode === 'headless'
                      ? '推荐理由由模型按你的工作背景个性化改写'
                      : '模型不可用，展示的是资料库预写理由',
                  }, current.mode === 'headless' ? '个性化' : '离线理由'),
                  current.sourceDate ? h('span', null, `${current.sourceDate}`) : null,
                  current.sourceUrl
                    ? h('a', { href: current.sourceUrl, target: '_blank', rel: 'noreferrer noopener' }, '官方原文 ↗')
                    : h('span', null, '内置资源库'))
                )
              : h('p', { className: 'pt-empty' }, running ? '小精灵正在挑第一条推荐…' : '小精灵还没有推荐过。'),
            data?.lastError ? h('p', { className: 'pt-warn' }, `上次推荐没成功：${String(data.lastError.message || '').slice(0, 90)}`) : null,
            error ? h('p', { className: 'pt-warn' }, '连接中断，重试中…') : null),
          // ── foot：常驻功能排（不随内容滚动）
          h('div', { className: 'pt-foot' },
            current
              ? h('button', {
                className: 'pt-btn', type: 'button', 'data-primary': 'on', 'data-copied': copiedId === current.id ? 'on' : 'off',
                onClick: copyPrompt,
                'aria-label': '复制当前显示的版本',
              }, copiedId === current.id ? '已复制 ✓' : (hasSplit && promptView === 'zh' ? '复制中文翻译' : '复制 EN 模板'))
              : null,
            h('button', { className: 'pt-btn', type: 'button', 'data-primary': current ? 'off' : 'on', disabled: running, onClick: pickOne, 'aria-label': '手动捞一条' }, running ? '翻找中…' : '捞一条'),
            h('button', { className: 'pt-btn', type: 'button', onClick: dismiss, 'aria-label': '收起这条推荐' }, '收起'))));

      const pet = h('div', {
        className: 'pt-pet',
        onMouseDown: startDrag,
        onClick: () => {
          if (suppress.current) { suppress.current = false; return; }
          if (open) { setOpen(false); setPinned(null); setShowSkins(false); return; }
          setPinned(latest?.id || null);
          setOpen(true);
        },
        role: 'button',
        tabIndex: 0,
        onKeyDown: (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (open) { setOpen(false); setPinned(null); return; }
          setPinned(latest?.id || null);
          setOpen(true);
        },
        'aria-label': `Prompt 小精灵，${unread ? `${unread} 条未读推荐` : '没有新推荐'}，点开或收起`,
      },
      spriteSrc() && !spriteBroken
        ? h('img', {
          className: 'pt-img',
          'data-talking': excitedNow || running ? 'on' : 'off',
          'data-sleeping': isQuietNow && !moodActive ? 'on' : 'off',
          src: spriteSrc(), alt: 'Prompt 小精灵', draggable: false, onError: () => setSpriteBroken(true),
        })
        : h('div', { className: 'pt-fallback', role: 'img', 'aria-label': 'Prompt 小精灵' }, '🧚'),
      unread > 0 ? h('span', { className: 'pt-badge', 'aria-hidden': true }, unread > 9 ? '9+' : String(unread)) : null,
      h('span', { className: 'pt-tag' },
        h('i', { className: 'pt-dot', 'data-off': error ? 'off' : 'on' }),
        isQuietNow && !moodActive ? '打盹中 zZ'
          : running ? '忙碌中' : Number.isFinite(countdown) && countdown > 0 ? `${mmss(countdown)} 后再见` : '待命中'));

      const style = pos ? { left: pos.x, top: pos.y } : { right: 20, bottom: 96 };
      // The card hangs left of the sprite; near the left edge it flips right.
      const side = pos && pos.x < 400 ? 'right' : 'left';

      return h('div', { style, 'data-prompt-tips': true },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h('div', { className: 'pt-anchor', 'data-side': side }, pet, open ? card : null));
    }

    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'dsh-plugin-prompt-tips', order: 87,
      }, Pet));
    }

    return { apply, inject: ['slots'] };
  },
});
