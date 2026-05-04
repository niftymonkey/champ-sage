import styles from "./SurfacePlaceholder.module.css";

interface SurfacePlaceholderProps {
  eyebrow: string;
  headline: string;
  subhead?: string;
}

/**
 * Stand-in for a surface whose real content lands in a later phase of the
 * v16 redesign. Renders the v16 type system at the right rhythm so the empty
 * surface still looks like part of the app rather than a dev placeholder.
 */
export function SurfacePlaceholder({
  eyebrow,
  headline,
  subhead,
}: SurfacePlaceholderProps) {
  return (
    <div className={styles.placeholder}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h1 className={styles.headline}>{headline}</h1>
      {subhead ? <p className={styles.subhead}>{subhead}</p> : null}
    </div>
  );
}
