import { MoreHorizontal, Sparkles } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAskAction } from "@/components/ai/ask/ask-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useTopBarDensity } from "./top-bar-density";

/** A secondary top-bar action that moves into "More" when the bar is crowded. */
export type TopBarOverflowItem = {
  /** Stable within the page. */
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
};

type Registry = {
  register: (item: TopBarOverflowItem) => () => void;
  /** A page menu that shows the overflow itself (see useTopBarOverflowHost). */
  claimHost: () => () => void;
};

const TopBarOverflowContext = createContext<Registry | null>(null);
// Kept apart from the (stable) registry so registering never re-registers.
const TopBarOverflowItemsContext = createContext<TopBarOverflowItem[]>([]);

/** The items pages handed to the crowded top bar, in mount order. */
export function useTopBarOverflowRegistry() {
  const [items, setItems] = useState<TopBarOverflowItem[]>([]);
  const [hosts, setHosts] = useState(0);
  const register = useCallback((item: TopBarOverflowItem) => {
    setItems((current) => [
      ...current.filter((existing) => existing.id !== item.id),
      item,
    ]);
    return () =>
      setItems((current) =>
        current.filter((existing) => existing.id !== item.id),
      );
  }, []);
  const claimHost = useCallback(() => {
    setHosts((count) => count + 1);
    return () => setHosts((count) => count - 1);
  }, []);
  const registry = useMemo(
    () => ({ register, claimHost }),
    [register, claimHost],
  );
  return { items, registry, hosted: hosts > 0 };
}

export function TopBarOverflowProvider({
  registry,
  items,
  children,
}: {
  registry: Registry;
  items: TopBarOverflowItem[];
  children: ReactNode;
}) {
  return (
    <TopBarOverflowContext.Provider value={registry}>
      <TopBarOverflowItemsContext.Provider value={items}>
        {children}
      </TopBarOverflowItemsContext.Provider>
    </TopBarOverflowContext.Provider>
  );
}

/**
 * For a page whose top-bar actions end in a menu of their own: while the
 * bar is crowded, returns Ask and the collapsed actions for that menu to
 * list first, and the bar drops its separate "More" button, so there is
 * one "…" rather than two. Null while the bar has room.
 */
export function useTopBarOverflowHost(): TopBarOverflowItem[] | null {
  const registry = useContext(TopBarOverflowContext);
  const items = useContext(TopBarOverflowItemsContext);
  const density = useTopBarDensity();
  const ask = useAskAction();
  const active = registry !== null && density !== "full";
  const claimHost = registry?.claimHost;

  useEffect(() => {
    if (!active || !claimHost) return;
    return claimHost();
  }, [active, claimHost]);

  if (!active) return null;
  return [
    ...(ask
      ? [
          {
            id: "ask",
            label: ask.label,
            icon: <Sparkles aria-hidden />,
            onSelect: ask.onSelect,
          },
        ]
      : []),
    ...items,
  ];
}

/**
 * A page's secondary top-bar action: `children` (the inline button) while
 * the bar has room, an entry in the bar's "More" menu once it is crowded,
 * so the page's name stays readable. Outside a top bar it is always inline.
 */
export function TopBarCollapsible({
  item,
  children,
}: {
  item: TopBarOverflowItem;
  children: ReactNode;
}) {
  const density = useTopBarDensity();
  const registry = useContext(TopBarOverflowContext);
  const collapsed = registry !== null && density !== "full";
  // The latest handler without re-registering on every render.
  const latest = useRef(item);
  latest.current = item;
  const { id, label } = item;

  // Keyed on id and label only: an icon element is new on every render.
  useEffect(() => {
    if (!collapsed || !registry) return;
    return registry.register({
      id,
      label,
      icon: latest.current.icon,
      onSelect: () => latest.current.onSelect(),
    });
  }, [collapsed, registry, id, label]);

  return collapsed ? null : children;
}

/**
 * The crowded top bar's "More" menu: Ask, then the page's collapsed
 * actions. Renders nothing when there is nothing to put in it.
 */
export function TopBarMoreMenu({ items }: { items: TopBarOverflowItem[] }) {
  const { t } = useTranslation();
  const ask = useAskAction();
  const label = t("navigation:sidebar.more");
  if (!ask && items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={label}
            title={label}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-hidden hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent data-popup-open:text-foreground"
            data-slot="top-bar-more"
          />
        }
      >
        <MoreHorizontal aria-hidden className="size-4.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {ask && (
          <DropdownMenuItem onClick={ask.onSelect}>
            <Sparkles aria-hidden />
            {ask.label}
          </DropdownMenuItem>
        )}
        {items.map((item) => (
          <DropdownMenuItem key={item.id} onClick={item.onSelect}>
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
