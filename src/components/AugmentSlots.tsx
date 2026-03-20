import { useState } from "react";
import type { Augment } from "../lib/data-ingest/types";
import { AugmentCard } from "./AugmentCard";
import { AugmentPicker } from "./AugmentPicker";

const MAX_AUGMENT_SLOTS = 4;

interface AugmentSlotsProps {
  selectedAugments: Augment[];
  availableAugments: Map<string, Augment>;
  onSelect: (augment: Augment) => void;
  onReset: () => void;
}

export function AugmentSlots({
  selectedAugments,
  availableAugments,
  onSelect,
  onReset,
}: AugmentSlotsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function handleSelect(augment: Augment) {
    onSelect(augment);
    setPickerOpen(false);
  }

  const nextEmptySlot = selectedAugments.length;
  const canPick = nextEmptySlot < MAX_AUGMENT_SLOTS;

  return (
    <div className="augment-slots-container">
      <div className="augment-slots-header">
        <p className="entity-title">Your Augments</p>
        {selectedAugments.length > 0 && (
          <button className="refresh-btn" onClick={onReset}>
            Clear
          </button>
        )}
      </div>
      <div className="augment-slots">
        {Array.from({ length: MAX_AUGMENT_SLOTS }, (_, i) => {
          const augment = selectedAugments[i];
          const isEmpty = !augment;
          const isClickable = isEmpty && i === nextEmptySlot && canPick;

          return isEmpty ? (
            <div
              key={i}
              className={`augment-slot augment-slot-empty${isClickable ? " augment-slot-clickable" : ""}`}
              onClick={isClickable ? () => setPickerOpen(true) : undefined}
            >
              <div className="augment-slot-placeholder">
                <span className="augment-slot-number">{i + 1}</span>
                {isClickable && (
                  <span className="augment-slot-hint">Tap to choose</span>
                )}
              </div>
            </div>
          ) : (
            <AugmentCard key={i} augment={augment} />
          );
        })}
      </div>

      {pickerOpen && (
        <div className="augment-picker-overlay">
          <div className="augment-picker-overlay-header">
            <p className="entity-title">Choose Augment</p>
            <button
              className="refresh-btn"
              onClick={() => setPickerOpen(false)}
            >
              Cancel
            </button>
          </div>
          <AugmentPicker augments={availableAugments} onSelect={handleSelect} />
        </div>
      )}
    </div>
  );
}
