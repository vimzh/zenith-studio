"use client";

import { ArrowUp } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

const MAX_ROWS = 6;

export type AIPromptInputProps = {
  className?: string;
  disabled?: boolean;
  maxLength?: number;
  onSubmit: (value: string) => void;
  placeholder?: string;
};

export default function AIPromptInput({
  className,
  disabled = false,
  maxLength,
  onSubmit,
  placeholder = "Ask anything…",
}: AIPromptInputProps) {
  const shouldReduceMotion = useReducedMotion();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const canSubmit = value.trim().length > 0 && !disabled;

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const lineHeight = Number.parseFloat(
      getComputedStyle(textarea).lineHeight || "20"
    );
    const maxHeight = lineHeight * MAX_ROWS;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useLayoutEffect(resize, [resize, value]);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(value.trim());
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <motion.div
      className={cn(
        "w-full rounded-[18px] border bg-background/95 p-2 text-foreground",
        isFocused ? "border-white/50" : "border-white/20",
        className
      )}
      layout={shouldReduceMotion ? false : "position"}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { bounce: 0.1, duration: 0.25, type: "spring" }
      }
    >
      <textarea
        className="max-h-48 min-h-12 w-full resize-none bg-transparent px-3 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground"
        disabled={disabled}
        maxLength={maxLength}
        onBlur={() => setIsFocused(false)}
        onChange={handleChange}
        onFocus={() => setIsFocused(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={value}
      />

      <div className="flex justify-end">
        <motion.button
          aria-label="Generate asset"
          className="flex size-10 items-center justify-center rounded-full bg-foreground text-background disabled:bg-muted disabled:text-muted-foreground"
          disabled={!canSubmit}
          onClick={submit}
          type="button"
          whileHover={canSubmit && !shouldReduceMotion ? { scale: 1.05 } : undefined}
          whileTap={canSubmit && !shouldReduceMotion ? { scale: 0.95 } : undefined}
        >
          <ArrowUp aria-hidden="true" className="size-5" />
        </motion.button>
      </div>
    </motion.div>
  );
}
