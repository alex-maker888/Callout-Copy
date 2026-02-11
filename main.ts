import { MarkdownView, Menu, Notice, Plugin, setIcon } from "obsidian";

export default class CallbackCopyPlugin extends Plugin {
	private observer: MutationObserver | null = null;

	onload(): void {
		this.injectCopyButtons();

		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.injectCopyButtons()),
		);

		this.startObserver();
	}

	onunload(): void {
		this.observer?.disconnect();
		this.observer = null;

		document
			.querySelectorAll<HTMLElement>(".callback-copy-btn")
			.forEach((button) => button.remove());

		document
			.querySelectorAll<HTMLElement>(".callback-copy-enabled")
			.forEach((callout) => callout.classList.remove("callback-copy-enabled"));
	}

	private startObserver(): void {
		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				mutation.addedNodes.forEach((node) => {
					if (!(node instanceof HTMLElement)) {
						return;
					}

					if (node.matches(".callout")) {
						this.addCopyButton(node);
					}

					node
						.querySelectorAll<HTMLElement>(".callout")
						.forEach((callout) => this.addCopyButton(callout));
				});
			}
		});

		this.observer.observe(this.app.workspace.containerEl, {
			childList: true,
			subtree: true,
		});
	}

	private injectCopyButtons(): void {
		document
			.querySelectorAll<HTMLElement>(".callout")
			.forEach((callout) => this.addCopyButton(callout));
	}

	private addCopyButton(callout: HTMLElement): void {
		if (callout.querySelector(".callback-copy-btn")) {
			return;
		}

		callout.classList.add("callback-copy-enabled");

		const button = document.createElement("button");
		button.className = "callback-copy-btn";
		button.type = "button";
		button.ariaLabel = "Copy callout";
		setIcon(button, "copy");

		button.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();

			const copied = await this.copyCalloutPlainTextOnly(callout);
			if (!copied) {
				new Notice("Failed to copy callout");
				return;
			}

			setIcon(button, "check");
			window.setTimeout(() => setIcon(button, "copy"), 1200);
		});

		button.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.openCopyMenu(event, callout, button);
		});

		callout.appendChild(button);
	}

	private openCopyMenu(
		event: MouseEvent,
		callout: HTMLElement,
		button: HTMLElement,
	): void {
		const menu = new Menu();

		menu.addItem((item) => {
			item
				.setTitle("Copy plain text")
				.setIcon("copy")
				.onClick(async () => {
					const copied = await this.copyCalloutPlainTextOnly(callout);
					if (!copied) {
						new Notice("Failed to copy callout");
						return;
					}

					this.flashSuccess(button);
					new Notice("Copied callout as plain text");
				});
		});

		menu.addItem((item) => {
			item
				.setTitle("Copy rich text")
				.setIcon("image")
				.onClick(async () => {
					const copied = await this.copyCalloutRichText(callout);
					if (!copied) {
						new Notice("Failed to copy rich text");
						return;
					}

					this.flashSuccess(button);
					new Notice("Copied callout as rich text");
				});
		});

		menu.addItem((item) => {
			item
				.setTitle("Copy markdown")
				.setIcon("file-text")
				.onClick(async () => {
					const markdown = await this.getCalloutMarkdown(callout);
					if (markdown === null) {
						new Notice("Could not resolve callout markdown");
						return;
					}

					const copied = await this.copyText(markdown);
					if (!copied) {
						new Notice("Failed to copy markdown");
						return;
					}

					this.flashSuccess(button);
					new Notice("Copied callout as markdown");
				});
		});

		menu.showAtMouseEvent(event);
	}

	private flashSuccess(button: HTMLElement): void {
		setIcon(button, "check");
		window.setTimeout(() => setIcon(button, "copy"), 1200);
	}

	private async copyCalloutPlainTextOnly(callout: HTMLElement): Promise<boolean> {
		const text = this.getCalloutPlainText(callout);
		if (!text) {
			return false;
		}

		return this.copyText(text);
	}

	private async copyCalloutRichText(callout: HTMLElement): Promise<boolean> {
		const clone = callout.cloneNode(true) as HTMLElement;
		clone.querySelector(".callback-copy-btn")?.remove();

		const text = clone.innerText.trim();
		if (!text) {
			return false;
		}

		const richCopied = await this.copyRichCalloutContent(clone, text);
		if (richCopied) {
			return true;
		}

		return this.copyText(text);
	}

	private getCalloutPlainText(callout: HTMLElement): string {
		const clone = callout.cloneNode(true) as HTMLElement;
		clone.querySelector(".callback-copy-btn")?.remove();
		return clone.innerText.trim();
	}

	private async copyRichCalloutContent(
		calloutClone: HTMLElement,
		plainText: string,
	): Promise<boolean> {
		if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
			return false;
		}

		const richClone = calloutClone.cloneNode(true) as HTMLElement;
		await this.inlineImagesAsDataUrls(richClone);
		const html = richClone.outerHTML;

		if (!html.trim()) {
			return false;
		}

		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					"text/plain": new Blob([plainText], { type: "text/plain" }),
					"text/html": new Blob([html], { type: "text/html" }),
				}),
			]);

			return true;
		} catch {
			return false;
		}
	}

	private async inlineImagesAsDataUrls(root: HTMLElement): Promise<void> {
		const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));

		await Promise.all(
			images.map(async (image) => {
				const source = image.currentSrc || image.src;
				if (!source) {
					return;
				}

				try {
					const response = await fetch(source);
					if (!response.ok) {
						return;
					}

					const blob = await response.blob();
					if (!blob.type.startsWith("image/")) {
						return;
					}

					const dataUrl = await this.blobToDataUrl(blob);
					image.src = dataUrl;
					image.removeAttribute("srcset");
				} catch {
					// Best effort: keep original src if data-url conversion fails.
				}
			}),
		);
	}

	private blobToDataUrl(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onloadend = () => {
				if (typeof reader.result === "string") {
					resolve(reader.result);
					return;
				}

				reject(new Error("Failed to convert blob to data URL"));
			};
			reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
			reader.readAsDataURL(blob);
		});
	}

	private async getCalloutMarkdown(callout: HTMLElement): Promise<string | null> {
		const viewRoot = callout.closest(
			".markdown-reading-view, .markdown-preview-view, .markdown-source-view",
		);

		if (!(viewRoot instanceof HTMLElement)) {
			return null;
		}

		const sourceFile = this.resolveSourceFileForCallout(callout);
		if (!sourceFile) {
			return null;
		}

		const renderedCallouts = Array.from(viewRoot.querySelectorAll<HTMLElement>(".callout"));
		const calloutIndex = renderedCallouts.indexOf(callout);
		if (calloutIndex === -1) {
			return null;
		}

		const fileText = await this.app.vault.cachedRead(sourceFile);
		const blocks = this.extractCalloutBlocks(fileText);
		const selectedBlock = blocks[calloutIndex];

		if (!selectedBlock) {
			return null;
		}

		return this.extractCalloutBodyMarkdown(selectedBlock);
	}

	private resolveSourceFileForCallout(callout: HTMLElement) {
		const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");

		for (const leaf of markdownLeaves) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) {
				continue;
			}

			if (view.contentEl.contains(callout) || view.containerEl.contains(callout)) {
				return view.file;
			}
		}

		return this.app.workspace.getActiveFile();
	}

	private extractCalloutBlocks(markdown: string): string[] {
		const lines = markdown.split(/\r?\n/);
		const blocks: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			if (!/^\s*>\s*\[![-\w]+\]/i.test(lines[i])) {
				continue;
			}

			const blockLines: string[] = [];
			let j = i;

			while (j < lines.length && /^\s*>/.test(lines[j])) {
				blockLines.push(lines[j]);
				j++;
			}

			blocks.push(blockLines.join("\n").trimEnd());
			i = j - 1;
		}

		return blocks;
	}

	private extractCalloutBodyMarkdown(calloutBlock: string): string {
		const lines = calloutBlock.split(/\r?\n/);
		const firstLine = lines[0] ?? "";
		const titleMatch = firstLine.match(/^\s*>\s*\[![-\w]+\]\s*(.*)$/i);
		const title = (titleMatch?.[1] ?? "").trim();

		const body = lines
			.slice(1)
			.map((line) => line.replace(/^\s*>\s?/, ""))
			.join("\n")
			.trim();

		if (title && body) {
			return `${title}\n\n${body}`;
		}

		if (title) {
			return title;
		}

		return body;
	}

	private async copyText(text: string): Promise<boolean> {

		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.style.position = "fixed";
			textarea.style.left = "-9999px";
			document.body.appendChild(textarea);
			textarea.select();

			const success = document.execCommand("copy");
			document.body.removeChild(textarea);
			return success;
		}
	}
}