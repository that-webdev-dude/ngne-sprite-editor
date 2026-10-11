import { ContextMenu as RadixContextMenu } from "radix-ui";
import type { ReactNode } from "react";
import "./menu.css";

export type ContextMenuEntry =
    | {
          type?: "item";
          /** Stable key, for example a command id. */
          id: string;
          label: string;
          /** Shown right-aligned and muted. */
          shortcut?: string;
          /** Disabled items stay visible. */
          disabled?: boolean;
          onSelect(): void;
      }
    | { type: "separator"; id: string };

export interface ContextMenuProps {
    items: readonly ContextMenuEntry[];
    /** One element that accepts a ref and event props: the right-click target. */
    children: ReactNode;
    disabled?: boolean;
}

/**
 * Context menu (DESIGN §4): opens on right-click and, on a focused target, with the Menu key
 * or Shift+F10. Radix supplies roles, arrow-key navigation and typeahead.
 */
export function ContextMenu({ items, children, disabled = false }: ContextMenuProps) {
    return (
        <RadixContextMenu.Root>
            <RadixContextMenu.Trigger asChild disabled={disabled}>
                {children}
            </RadixContextMenu.Trigger>
            <RadixContextMenu.Portal>
                <RadixContextMenu.Content className="ui-menu" collisionPadding={8}>
                    {items.map((entry) =>
                        entry.type === "separator" ? (
                            <RadixContextMenu.Separator
                                key={entry.id}
                                className="ui-menu__separator"
                            />
                        ) : (
                            <RadixContextMenu.Item
                                key={entry.id}
                                className="ui-menu__item"
                                disabled={entry.disabled}
                                onSelect={entry.onSelect}
                            >
                                {entry.label}
                                {entry.shortcut ? (
                                    <span className="ui-menu__shortcut">{entry.shortcut}</span>
                                ) : null}
                            </RadixContextMenu.Item>
                        ),
                    )}
                </RadixContextMenu.Content>
            </RadixContextMenu.Portal>
        </RadixContextMenu.Root>
    );
}
