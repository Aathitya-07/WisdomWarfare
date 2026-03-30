import React from 'react';
import styles from './PlayerRanking.module.css';

const PlayerRanking = ({ players }) => {
  const maxScore = Math.max(...players.map(p => p.score));

  return (
    <div className={`bordered-container ${styles.rankingContainer}`}>
      <h3 className={styles.title}>PLAYER RANKING</h3>
      <ul className={styles.playerList}>
        {players.map(player => (
          <li key={player.rank} className={styles.playerItem}>
            <span className={styles.rank}>{player.rank}</span>
            <div className={styles.playerInfo}>
              <span className={styles.name}>{player.name} ({player.score})</span>
              <div className={styles.scoreBarContainer}>
                <div
                  className={styles.scoreBar}
                  style={{ width: `${(player.score / maxScore) * 100}%` }}
                ></div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PlayerRanking;