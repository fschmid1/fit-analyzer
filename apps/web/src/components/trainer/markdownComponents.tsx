import type { ComponentProps } from "react";
import type ReactMarkdown from "react-markdown";

export const mdComponents: ComponentProps<typeof ReactMarkdown>["components"] =
	{
		p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
		h1: ({ children }) => (
			<h1 className="text-lg font-bold text-[#e2d9f3] mt-3 mb-1 first:mt-0">
				{children}
			</h1>
		),
		h2: ({ children }) => (
			<h2 className="text-base font-bold text-[#e2d9f3] mt-3 mb-1 first:mt-0">
				{children}
			</h2>
		),
		h3: ({ children }) => (
			<h3 className="text-base font-semibold text-[#e2d9f3] mt-2 mb-1 first:mt-0">
				{children}
			</h3>
		),
		ul: ({ children }) => (
			<ul className="list-disc list-outside pl-4 mb-2 space-y-0.5">
				{children}
			</ul>
		),
		ol: ({ children }) => (
			<ol className="list-decimal list-outside pl-4 mb-2 space-y-0.5">
				{children}
			</ol>
		),
		li: ({ children }) => <li className="leading-relaxed">{children}</li>,
		strong: ({ children }) => (
			<strong className="font-semibold text-[#e2d9f3]">{children}</strong>
		),
		em: ({ children }) => <em className="italic text-[#d4b8fd]">{children}</em>,
		code: ({ children, className }) => {
			const isBlock = className?.includes("language-");
			return isBlock ? (
				<code className="block bg-[#0f0b1a] border border-[rgba(139,92,246,0.15)] rounded-lg px-3 py-2 my-2 text-sm font-mono text-[#a78bfa] overflow-x-auto whitespace-pre">
					{children}
				</code>
			) : (
				<code className="bg-[#0f0b1a] border border-[rgba(139,92,246,0.15)] rounded px-1.5 py-0.5 text-sm font-mono text-[#a78bfa]">
					{children}
				</code>
			);
		},
		pre: ({ children }) => <pre className="my-2">{children}</pre>,
		blockquote: ({ children }) => (
			<blockquote className="border-l-2 border-[#8b5cf6]/50 pl-3 my-2 text-[#a78bfa] italic">
				{children}
			</blockquote>
		),
		a: ({ href, children }) => (
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className="text-[#a78bfa] underline underline-offset-2 hover:text-[#c4b5fd] transition-colors"
			>
				{children}
			</a>
		),
		hr: () => <hr className="border-[rgba(139,92,246,0.2)] my-3" />,
		table: ({ children }) => (
			<div className="max-w-full overflow-x-auto my-2">
				<table className="w-full text-sm border-collapse">{children}</table>
			</div>
		),
		thead: ({ children }) => (
			<thead className="bg-[#8b5cf6]/10">{children}</thead>
		),
		th: ({ children }) => (
			<th className="border border-[rgba(139,92,246,0.2)] px-2 py-1.5 text-left font-semibold text-[#e2d9f3]">
				{children}
			</th>
		),
		td: ({ children }) => (
			<td className="border border-[rgba(139,92,246,0.15)] px-2 py-1.5 text-[#c4b5fd]">
				{children}
			</td>
		),
		tr: ({ children }) => <tr className="even:bg-[#8b5cf6]/5">{children}</tr>,
	};
