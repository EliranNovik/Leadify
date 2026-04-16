import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import {
    hasAnySupabaseAuthKey,
    readCachedSupabaseSessionFromStorage,
} from '../lib/authBootstrap';

// Module-level cache to prevent refetching on every component mount
interface CachedExternalUser {
    isExternalUser: boolean;
    userName: string | null;
    userImage: string | null;
    timestamp: number;
    userId: string;
}

let cachedExternalUser: CachedExternalUser | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Flag to track if check is in progress (prevents duplicate checks)
let checkInProgress = false;
let checkPromise: Promise<CachedExternalUser | null> | null = null;

/** Survives full page refresh so first paint can skip staff chrome + Dashboard. */
const EXTERNAL_USER_GATE_SS_KEY = 'crm_ext_user_gate_v1';

type ExternalUserGateBootstrap = {
    userId: string;
    isExternalUser: boolean;
    userName: string | null;
    userImage: string | null;
    ts: number;
};

function readExternalUserGateBootstrap(): ExternalUserGateBootstrap | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(EXTERNAL_USER_GATE_SS_KEY);
        if (!raw) return null;
        const d = JSON.parse(raw) as Partial<ExternalUserGateBootstrap>;
        if (!d?.userId || typeof d.userId !== 'string' || typeof d.isExternalUser !== 'boolean' || typeof d.ts !== 'number') {
            return null;
        }
        return {
            userId: d.userId,
            isExternalUser: d.isExternalUser,
            userName: typeof d.userName === 'string' || d.userName === null ? d.userName : null,
            userImage: typeof d.userImage === 'string' || d.userImage === null ? d.userImage : null,
            ts: d.ts,
        };
    } catch {
        return null;
    }
}

function persistExternalUserGate(entry: {
    userId: string;
    isExternalUser: boolean;
    userName: string | null;
    userImage: string | null;
}): void {
    if (typeof window === 'undefined') return;
    try {
        const payload: ExternalUserGateBootstrap = {
            ...entry,
            ts: Date.now(),
        };
        sessionStorage.setItem(EXTERNAL_USER_GATE_SS_KEY, JSON.stringify(payload));
    } catch {
        /* quota / private mode */
    }
}

/**
 * On `/` and `/external-home`, hide internal Sidebar / Header / bottom nav while
 * `useExternalUser` is still resolving (Sidebar previously only hid when `!isLoadingExternal`).
 */
export function shouldDeferInternalChrome(pathname: string, isLoadingExternal: boolean): boolean {
    return isLoadingExternal && (pathname === '/' || pathname === '/external-home');
}

function parseExternFlag(extern: unknown): boolean {
    return (
        extern === true ||
        extern === 'true' ||
        extern === 1 ||
        extern === '1' ||
        (typeof extern === 'string' && extern.toLowerCase() === 'true')
    );
}

function normalizeTenantsEmployee(raw: unknown): {
    official_name?: string | null;
    display_name?: string | null;
    photo_url?: string | null;
} | null {
    if (!raw) return null;
    const e = Array.isArray(raw) ? raw[0] : raw;
    if (!e || typeof e !== 'object') return null;
    return e as any;
}

async function fetchFirmContactProfileImageUrlByUserId(appUserId: string | null | undefined): Promise<string | null> {
    if (!appUserId) return null;
    try {
        const { data } = await supabase.from('firm_contacts').select('profile_image_url').eq('user_id', appUserId).maybeSingle();
        const v = (data as any)?.profile_image_url?.trim();
        return v ? String(v) : null;
    } catch {
        return null;
    }
}

type ResolvedExternalSession = {
    isExternalUser: boolean;
    userName: string | null;
    userImage: string | null;
    userId: string;
};

/**
 * Single source of truth: `public.users.auth_id` = Supabase auth user id.
 * No email-based user or firm_contact lookups (avoids refresh / casing mismatches).
 */
async function resolveExternalUserFromAuthSession(): Promise<ResolvedExternalSession | null> {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return null;

    const { data: row, error } = await supabase
        .from('users')
        .select(
            `
      id,
      extern,
      email,
      full_name,
      first_name,
      last_name,
      employee_id,
      tenants_employee!users_employee_id_fkey(
        official_name,
        display_name,
        photo_url
      )
    `,
        )
        .eq('auth_id', user.id)
        .maybeSingle();

    if (error || !row) {
        return {
            isExternalUser: false,
            userName: null,
            userImage: null,
            userId: user.id,
        };
    }

    const isExternal = parseExternFlag((row as any).extern);
    const emp = normalizeTenantsEmployee((row as any).tenants_employee);
    const rowEmail = String((row as any).email || user.email || '').trim();

    let userName: string | null = (row as any).full_name?.trim() || null;
    if (!userName && emp?.official_name?.trim()) userName = emp.official_name.trim();
    if (!userName && emp?.display_name?.trim()) userName = emp.display_name.trim();
    if (!userName && (row as any).first_name && (row as any).last_name) {
        userName = `${String((row as any).first_name).trim()} ${String((row as any).last_name).trim()}`;
    }
    if (!userName) userName = rowEmail || null;

    let userImage: string | null = null;
    if (isExternal) {
        userImage = await fetchFirmContactProfileImageUrlByUserId(String((row as any).id));
    }
    if (!userImage && emp?.photo_url) {
        const p = String(emp.photo_url).trim();
        userImage = p || null;
    }

    return {
        isExternalUser: isExternal,
        userName,
        userImage,
        userId: user.id,
    };
}

/**
 * Pre-check external user status in the background (e.g. during login).
 * Uses `users.auth_id` only; updates module cache when complete.
 */
export const preCheckExternalUser = async (userId?: string): Promise<void> => {
    if (checkInProgress && checkPromise) {
        await checkPromise;
        return;
    }

    if (cachedExternalUser) {
        const now = Date.now();
        if (now - cachedExternalUser.timestamp < CACHE_DURATION && (!userId || cachedExternalUser.userId === userId)) {
            return;
        }
    }

    checkInProgress = true;
    checkPromise = (async (): Promise<CachedExternalUser | null> => {
        try {
            const resolved = await resolveExternalUserFromAuthSession();
            if (!resolved) return null;
            if (userId && resolved.userId !== userId) return null;

            const entry: CachedExternalUser = {
                ...resolved,
                timestamp: Date.now(),
            };
            cachedExternalUser = entry;
            persistExternalUserGate({
                userId: entry.userId,
                isExternalUser: entry.isExternalUser,
                userName: entry.userName,
                userImage: entry.userImage,
            });
            return entry;
        } catch (error) {
            console.error('Error in preCheckExternalUser:', error);
            return null;
        } finally {
            checkInProgress = false;
            checkPromise = null;
        }
    })();

    await checkPromise;
};

export const useExternalUser = () => {
    // Start with cached data if available (instant initialization)
    const getInitialState = () => {
        try {
            const session = readCachedSupabaseSessionFromStorage();
            const currentUserId = session?.user?.id ? String(session.user.id) : null;

            if (currentUserId) {
                const boot = readExternalUserGateBootstrap();
                const now = Date.now();
                if (boot && boot.userId === currentUserId && now - boot.ts < CACHE_DURATION) {
                    return {
                        isExternalUser: boot.isExternalUser,
                        userName: boot.userName,
                        userImage: boot.userImage,
                        isLoading: false,
                    };
                }
            }

            if (cachedExternalUser && currentUserId) {
                const now = Date.now();
                if (cachedExternalUser.userId === currentUserId && now - cachedExternalUser.timestamp < CACHE_DURATION) {
                    return {
                        isExternalUser: cachedExternalUser.isExternalUser,
                        userName: cachedExternalUser.userName,
                        userImage: cachedExternalUser.userImage,
                        isLoading: false,
                    };
                }
            }

            const hasSessionHint = !!currentUserId || hasAnySupabaseAuthKey();

            return {
                isExternalUser: false,
                userName: null,
                userImage: null,
                isLoading: hasSessionHint,
            };
        } catch {
            return {
                isExternalUser: false,
                userName: null,
                userImage: null,
                isLoading: hasAnySupabaseAuthKey(),
            };
        }
    };

    const initialState = getInitialState();
    const [isExternalUser, setIsExternalUser] = useState<boolean>(initialState.isExternalUser);
    const [isLoading, setIsLoading] = useState<boolean>(initialState.isLoading);
    const [userName, setUserName] = useState<string | null>(initialState.userName);
    const [userImage, setUserImage] = useState<string | null>(initialState.userImage);

    useEffect(() => {
        let cancelled = false;

        const checkExternalUser = async () => {
            let authUserId: string | null = null;
            try {
                const { data: { user }, error: authError } = await supabase.auth.getUser();

                if (authError || !user) {
                    if (!cancelled) {
                        setIsExternalUser(false);
                        setUserName(null);
                        setUserImage(null);
                        setIsLoading(false);
                    }
                    return;
                }

                authUserId = user.id;

                const now = Date.now();
                if (
                    cachedExternalUser &&
                    cachedExternalUser.userId === user.id &&
                    now - cachedExternalUser.timestamp < CACHE_DURATION
                ) {
                    if (!cancelled) {
                        setIsExternalUser(cachedExternalUser.isExternalUser);
                        setUserName(cachedExternalUser.userName);
                        setUserImage(cachedExternalUser.userImage);
                        setIsLoading(false);
                    }
                    return;
                }

                if (checkInProgress && checkPromise) {
                    const waited = await checkPromise;
                    if (cancelled) return;
                    if (waited && waited.userId === user.id) {
                        setIsExternalUser(waited.isExternalUser);
                        setUserName(waited.userName);
                        setUserImage(waited.userImage);
                        setIsLoading(false);
                        return;
                    }
                }

                const resolved = await resolveExternalUserFromAuthSession();
                if (cancelled) return;

                if (!resolved) {
                    setIsExternalUser(false);
                    setUserName(null);
                    setUserImage(null);
                    setIsLoading(false);
                    return;
                }

                const entry: CachedExternalUser = {
                    ...resolved,
                    timestamp: Date.now(),
                };
                cachedExternalUser = entry;
                persistExternalUserGate({
                    userId: entry.userId,
                    isExternalUser: entry.isExternalUser,
                    userName: entry.userName,
                    userImage: entry.userImage,
                });
                setIsExternalUser(entry.isExternalUser);
                setUserName(entry.userName);
                setUserImage(entry.userImage);
                setIsLoading(false);
            } catch (error) {
                console.error('❌ Error checking external user status:', error);
                if (cancelled) return;
                if (cachedExternalUser && authUserId && cachedExternalUser.userId === authUserId) {
                    setIsExternalUser(cachedExternalUser.isExternalUser);
                    setUserName(cachedExternalUser.userName);
                    setUserImage(cachedExternalUser.userImage);
                    setIsLoading(false);
                } else {
                    setIsExternalUser(false);
                    setUserName(null);
                    setUserImage(null);
                    setIsLoading(false);
                }
            }
        };

        void checkExternalUser();
        return () => {
            cancelled = true;
        };
    }, []);


    return { isExternalUser, isLoading, userName, userImage };
};
