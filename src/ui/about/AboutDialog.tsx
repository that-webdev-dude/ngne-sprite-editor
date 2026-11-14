import { useState } from "react";
import type { AboutRequest } from "../../app/about/openAbout";
import { Button } from "../primitives/Button";
import { Dialog } from "../primitives/Dialog";
import { cx } from "../primitives/cx";
import "./about.css";

type CopyState = "idle" | "copying" | "copied" | "failed";

const COPY_MESSAGES: Record<CopyState, string> = {
    idle: "",
    copying: "",
    copied: "Version info copied.",
    failed: "Could not copy the version info: the clipboard is not available.",
};

/**
 * About NGNE Sprite Editor (Help menu): the app's name and version, the engine's version, the
 * licence, links to the repository and the changelog (each in a new tab), and Copy version
 * info, which copies the one line a bug report needs and says whether that worked.
 */
export function AboutDialog({ request }: Readonly<{ request: AboutRequest }>) {
    const { info } = request;
    const [copy, setCopy] = useState<CopyState>("idle");
    const copyLine = async () => {
        setCopy("copying");
        setCopy((await request.copy()) ? "copied" : "failed");
    };
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) request.answer(null);
            }}
            title={`About ${info.title}`}
            actions={
                <>
                    <Button disabled={copy === "copying"} onClick={() => void copyLine()}>
                        Copy version info
                    </Button>
                    <Button variant="primary" onClick={() => request.answer(null)}>
                        Close
                    </Button>
                </>
            }
        >
            <div className="about">
                <p className="about__name">
                    {info.title} {info.version}
                </p>
                <dl className="about__facts">
                    <dt>Engine</dt>
                    <dd>
                        {info.engine.packageName} {info.engine.version}
                    </dd>
                    <dt>Licence</dt>
                    <dd>{info.licence}</dd>
                </dl>
                <ul className="about__links">
                    <li>
                        <a href={info.repositoryUrl} target="_blank" rel="noopener noreferrer">
                            Source code on GitHub
                        </a>
                    </li>
                    <li>
                        <a href={info.changelogUrl} target="_blank" rel="noopener noreferrer">
                            Changelog
                        </a>
                    </li>
                </ul>
                {/* An <output> has the role status: the message is announced when it changes. */}
                <output
                    className={cx("about__status", copy === "failed" && "about__status--failed")}
                >
                    {COPY_MESSAGES[copy]}
                </output>
            </div>
        </Dialog>
    );
}
