import { TriangleAlert } from "lucide-react";
import { Component } from "react";
import type { ReactNode } from "react";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { IconButton } from "../primitives/IconButton";
import "./regionBoundary.css";

export interface RegionBoundaryProps {
    /** Region or panel name used in the message, for example "Timeline". */
    name: string;
    /** For regions too narrow for a line of text: an icon button carrying the message. */
    compact?: boolean;
    children: ReactNode;
}

interface RegionBoundaryState {
    failed: boolean;
}

/**
 * Error boundary around one region or panel (DESIGN §4): a crash inside it is replaced by a
 * one-line message and a Reload action that mounts the content again; the rest of the app
 * stays usable. React reports the caught error to the console.
 */
export class RegionBoundary extends Component<RegionBoundaryProps, RegionBoundaryState> {
    override state: RegionBoundaryState = { failed: false };

    static getDerivedStateFromError(): RegionBoundaryState {
        return { failed: true };
    }

    private readonly reload = () => this.setState({ failed: false });

    override render(): ReactNode {
        if (!this.state.failed) return this.props.children;
        const message = `${this.props.name} failed to render.`;
        if (this.props.compact) {
            return (
                <div className="region-error region-error--compact" role="alert">
                    <IconButton
                        label={`${message} Reload`}
                        tooltipSide="right"
                        onClick={this.reload}
                    >
                        <Icon icon={TriangleAlert} />
                    </IconButton>
                </div>
            );
        }
        return (
            <div className="region-error" role="alert">
                <span className="region-error__message">{message}</span>
                <Button onClick={this.reload}>Reload</Button>
            </div>
        );
    }
}
