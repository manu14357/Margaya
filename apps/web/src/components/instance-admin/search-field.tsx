import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

/** A search box that reports its text 300 ms after typing stops. */
export function SearchField({
  value,
  onChange,
  placeholder,
}: SearchFieldProps) {
  const [text, setText] = useState(value);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <InputGroup className="w-full sm:w-64">
      <InputGroupAddon>
        <Search aria-hidden />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onChange(next), 300);
        }}
      />
    </InputGroup>
  );
}
