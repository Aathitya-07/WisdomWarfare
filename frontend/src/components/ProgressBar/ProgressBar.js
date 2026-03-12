import React, { useState, useEffect } from 'react';
import styles from './ProgressBar.module.css';

const ProgressBar = ({ duration }) => {
  const [timeLeft, setTimeLeft] = useState(duration);

  useEffect(() => {
    if (timeLeft <= 0) {
      return;
    }

    const intervalId = setInterval(() => {
      setTimeLeft(prevTime => prevTime - 1);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [timeLeft]);

  const percentage = (timeLeft / duration) * 100;

  return (
    <div className={styles.container}>
      <div className={styles.progressBarContainer}>
        <div className={styles.progressBar} style={{ width: `${percentage}%` }}>
          <span className={styles.progressText}>{timeLeft}s</span>
        </div>
      </div>
    </div>
  );
};

export default ProgressBar;