import { CircleAlert, X } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "../primitives/Button";
import { cx } from "../primitives/cx";
import { Icon } from "../primitives/Icon";
import { IconButton } from "../primitives/IconButton";
import { toast } from "./toast";
import "./toast.css";

/** Renders the toast queue bottom-centre; mounted once by `UiRoot`. */
export function ToastViewport() {
    const toasts = useStore(toast.store, (state) => state.toasts);
    return (
        <div className="ui-toasts" role="region" aria-label="Notifications" aria-live="polite">
            {toasts.map((item) =>
                item.kind === "error" ? (
                    <div key={item.id} className={cx("ui-toast", "ui-toast--error")} role="alert">
                        <span className="ui-toast__icon">
                            <Icon icon={CircleAlert} />
                        </span>
                        <span className="ui-toast__message">{item.message}</span>
                        <IconButton
                            label="Dismiss"
                            tooltipSide="top"
                            onClick={() => toast.dismiss(item.id)}
                        >
                            <Icon icon={X} />
                        </IconButton>
                    </div>
                ) : (
                    <div
                        key={item.id}
                        className={cx("ui-toast", item.action && "ui-toast--action")}
                        role="status"
                    >
                        <span className="ui-toast__message">{item.message}</span>
                        {item.action ? (
                            <>
                                <Button
                                    onClick={() => {
                                        toast.dismiss(item.id);
                                        item.action?.run();
                                    }}
                                >
                                    {item.action.label}
                                </Button>
                                <IconButton
                                    label="Dismiss"
                                    tooltipSide="top"
                                    onClick={() => toast.dismiss(item.id)}
                                >
                                    <Icon icon={X} />
                                </IconButton>
                            </>
                        ) : null}
                    </div>
                ),
            )}
        </div>
    );
}
