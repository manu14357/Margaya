import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type MenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

/**
 * The Files window's context menu: a `menu` of `menuitem`s at a point,
 * kept inside the window. Arrow keys, Home and End move, Enter or Space
 * picks, Escape and Tab close it; focus goes back where it came from.
 */
export function FilesMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const returnFocus = useRef<Element | null>(null);

  useLayoutEffect(() => {
    returnFocus.current = document.activeElement;
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
    menu
      .querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onBlur = () => onClose();
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
      const back = returnFocus.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (next: number) => {
      buttons[(next + buttons.length) % buttons.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focus(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focus(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focus(0);
        break;
      case "End":
        event.preventDefault();
        focus(buttons.length - 1);
        break;
      case "Escape":
      case "Tab":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={ref}
      className="files-menu"
      role="menu"
      aria-label={label}
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="files-menu-item"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
