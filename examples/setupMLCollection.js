const { QdrantClient } = require('@qdrant/js-client-rest');
const { getEmbedding } = require('../index');

const COLLECTION_NAME = 'ml_knowledge';

// Comprehensive ML content to be stored
const mlDocuments = [
  {
    id: 1,
    content: `What is Machine Learning?
Machine Learning (ML) is a subset of artificial intelligence that enables computer systems to learn and improve from experience without being explicitly programmed. It focuses on developing algorithms that can access data and use it to learn for themselves.

Core Concepts:
- Pattern Recognition: ML systems identify patterns in data through statistical analysis and mathematical models
- Automated Learning: Systems automatically improve their performance as they are exposed to more data over time
- Predictive Analytics: Uses historical data to make predictions about future events or behaviors
- Data-Driven Decisions: Makes decisions based on data patterns rather than explicit programming rules

The Machine Learning Pipeline:
1. Data Collection: Gathering relevant data from various sources
2. Data Preprocessing: Cleaning, transforming, and preparing data for analysis
3. Feature Engineering: Selecting and creating relevant features from raw data
4. Model Selection: Choosing appropriate algorithms based on problem type
5. Training: Teaching the model using training data
6. Evaluation: Testing model performance on unseen data
7. Deployment: Implementing the model in production environments
8. Monitoring: Continuously tracking model performance and retraining as needed

Types of Learning:
- Batch Learning: Models are trained on entire datasets at once
- Online Learning: Models learn incrementally from streaming data
- Transfer Learning: Applying knowledge from one domain to another
- Active Learning: Models query humans for labels on ambiguous examples

Real-World Impact:
Machine learning powers numerous applications we use daily, from email filtering and voice assistants to recommendation systems and fraud detection. It has revolutionized industries by enabling automation, improving decision-making, and uncovering insights from massive datasets that would be impossible for humans to process manually.`,
    metadata: { topic: 'introduction', category: 'basics', difficulty: 'beginner' }
  },
  {
    id: 2,
    content: `Advantages of Machine Learning:

1. Automation and Efficiency:
- Automates repetitive tasks, freeing human resources for strategic work
- Processes data at speeds impossible for humans
- Reduces manual errors and inconsistencies
- Enables 24/7 operation without fatigue
- Scales efficiently to handle increasing workloads

2. Handling Complex Data:
- Processes multi-dimensional data with thousands of features
- Handles unstructured data (text, images, audio, video)
- Works with massive datasets (big data) efficiently
- Identifies non-linear relationships in data
- Manages heterogeneous data from multiple sources

3. Continuous Improvement:
- Model performance improves with more data exposure
- Adaptive learning adjusts to changing patterns
- Self-correcting mechanisms reduce errors over time
- Learns from feedback loops automatically
- Updates predictions based on new information

4. Superior Pattern Recognition:
- Detects subtle patterns invisible to human observers
- Identifies complex correlations across multiple variables
- Recognizes patterns in noisy or incomplete data
- Discovers hidden insights in large datasets
- Predicts trends before they become obvious

5. Wide Application Spectrum:
- Healthcare: Disease diagnosis, drug discovery, personalized treatment
- Finance: Fraud detection, algorithmic trading, credit scoring
- Retail: Demand forecasting, inventory optimization, customer segmentation
- Manufacturing: Predictive maintenance, quality control, supply chain optimization
- Transportation: Route optimization, autonomous vehicles, traffic prediction
- Entertainment: Content recommendation, personalization, trend analysis

6. Minimal Human Intervention:
- Operates autonomously after training
- Makes real-time decisions without human oversight
- Handles edge cases through learned patterns
- Reduces dependency on domain experts for routine decisions
- Frees humans for creative and strategic thinking

7. Cost-Effectiveness:
- Reduces operational costs through automation
- Minimizes waste through optimization
- Prevents costly errors through early detection
- Improves resource allocation efficiency
- Delivers high ROI through improved productivity

8. Personalization at Scale:
- Delivers individualized experiences to millions of users
- Adapts content based on user preferences and behavior
- Provides tailored recommendations in real-time
- Creates dynamic user experiences
- Enhances customer satisfaction and engagement

9. Predictive Capabilities:
- Forecasts future trends with high accuracy
- Enables proactive decision-making
- Reduces risks through early warning systems
- Optimizes planning and resource allocation
- Identifies opportunities before competitors

10. Handling Uncertainty:
- Makes probabilistic predictions with confidence scores
- Quantifies uncertainty in predictions
- Adapts to incomplete or noisy data
- Provides robust predictions in ambiguous situations
- Manages risk through probabilistic reasoning`,
    metadata: { topic: 'advantages', category: 'benefits', difficulty: 'beginner' }
  },
  {
    id: 3,
    content: `Disadvantages and Challenges of Machine Learning:

1. Data Dependency and Quality Issues:
- Requires large volumes of high-quality labeled data
- Performance heavily depends on data quality (garbage in, garbage out)
- Data collection can be expensive and time-consuming
- Labeling data requires significant human effort
- Imbalanced datasets lead to biased models
- Missing or incomplete data reduces accuracy
- Data privacy concerns limit access to valuable datasets
- Requires representative data covering all scenarios

2. Computational Requirements:
- Training complex models requires expensive GPU/TPU hardware
- High energy consumption for training and inference
- Long training times for deep learning models
- Storage requirements for large datasets and models
- Infrastructure costs for deployment and scaling
- Cloud computing costs can be significant
- Edge deployment limited by device computational power

3. Model Interpretability (Black Box Problem):
- Complex models like deep neural networks are difficult to interpret
- Hard to explain why a model made a specific prediction
- Lack of transparency creates trust issues in critical applications
- Regulatory compliance challenges (GDPR, medical regulations)
- Difficult to debug when models make errors
- Stakeholders may resist adoption without explainability
- Limited ability to incorporate domain knowledge
- Hard to identify and fix systematic biases

4. Overfitting and Generalization Issues:
- Models may memorize training data instead of learning patterns
- Poor performance on new, unseen data
- Requires careful validation and testing strategies
- Need for separate validation and test datasets
- Hyperparameter tuning can be time-consuming
- Risk of data leakage from training to test sets
- Requires regularization techniques to prevent overfitting
- Performance may degrade over time (model drift)

5. Bias, Fairness, and Ethics:
- Models inherit biases present in training data
- Can perpetuate or amplify societal biases and discrimination
- Fairness across different demographic groups is challenging
- Historical biases encoded in data lead to unfair outcomes
- Algorithmic discrimination in hiring, lending, criminal justice
- Lack of diversity in training data causes representation issues
- Difficult to define and measure fairness mathematically
- Trade-offs between accuracy and fairness

6. Security and Adversarial Vulnerabilities:
- Adversarial attacks can fool models with imperceptible changes
- Data poisoning attacks corrupt training data
- Model inversion attacks can extract training data
- Privacy breaches through membership inference attacks
- Models can be stolen through API queries
- Backdoor attacks embed malicious behavior
- Robust security measures add complexity and cost
- Continuous monitoring required to detect attacks

7. Expertise and Skill Requirements:
- Shortage of skilled ML engineers and data scientists
- Requires knowledge of mathematics, statistics, and programming
- Understanding of domain-specific problems necessary
- Keeping up with rapidly evolving field is challenging
- Interdisciplinary collaboration needed
- High salaries for qualified professionals
- Long learning curve for beginners
- Need for ongoing education and training

8. Maintenance and Operational Challenges:
- Models require continuous monitoring and updates
- Performance degrades over time due to concept drift
- Data distribution changes require retraining
- Version control for models and data pipelines
- A/B testing and gradual rollout necessary
- Dependency management and reproducibility issues
- Integration with existing systems can be complex
- Need for robust MLOps practices and infrastructure

9. Ethical and Societal Concerns:
- Job displacement due to automation
- Privacy concerns with personal data collection
- Potential for misuse in surveillance and manipulation
- Accountability issues when models make harmful decisions
- Environmental impact of training large models
- Digital divide and unequal access to AI benefits
- Autonomous systems raise moral and legal questions
- Need for ethical guidelines and governance

10. Limitations and Realistic Expectations:
- Not a silver bullet for all problems
- Some problems better solved with traditional methods
- Requires substantial investment before seeing returns
- May not work well with small datasets
- Struggles with tasks requiring common sense reasoning
- Limited ability to handle truly novel situations
- Causation vs correlation challenges
- Overhype can lead to unrealistic expectations and disappointment`,
    metadata: { topic: 'disadvantages', category: 'limitations', difficulty: 'intermediate' }
  },
  {
    id: 4,
    content: `Supervised Learning - Comprehensive Guide:

Overview:
Supervised learning is the most common machine learning paradigm where models learn from labeled training data. The algorithm learns a mapping function from input variables (X) to output variables (Y), where the correct outputs are known during training.

Mathematical Foundation:
- Goal: Learn function f such that Y = f(X)
- Training: Given dataset D = {(x₁, y₁), (x₂, y₂), ..., (xₙ, yₙ)}
- Objective: Minimize loss function L(f(X), Y)
- Evaluation: Test on unseen data to measure generalization

Types of Supervised Learning:
1. Classification: Predicting discrete class labels
2. Regression: Predicting continuous numerical values

Key Algorithms in Detail:

1. Linear Regression:
- Use Case: Predicting continuous values (house prices, stock prices, temperature)
- How it Works: Fits a linear equation to observed data: y = β₀ + β₁x₁ + β₂x₂ + ... + βₙxₙ
- Assumptions: Linear relationship, independence, homoscedasticity, normal distribution of errors
- Advantages: Simple, interpretable, fast training, works well with linear relationships
- Disadvantages: Limited to linear relationships, sensitive to outliers, multicollinearity issues
- Variations: Ridge regression (L2 regularization), Lasso (L1 regularization), Elastic Net

2. Logistic Regression:
- Use Case: Binary classification (spam detection, disease diagnosis, customer churn)
- How it Works: Uses sigmoid function to map predictions to probabilities: P(Y=1) = 1/(1+e^(-z))
- Output: Probability between 0 and 1
- Decision Boundary: Linear separation of classes
- Advantages: Probabilistic interpretation, efficient, works well for linearly separable data
- Disadvantages: Assumes linear decision boundary, requires feature scaling
- Extensions: Multinomial logistic regression for multi-class problems

3. Decision Trees:
- Use Case: Both classification and regression, customer segmentation, credit approval
- How it Works: Recursively splits data based on feature values creating tree structure
- Splitting Criteria: Information Gain (ID3), Gini Impurity (CART), Variance Reduction (regression)
- Advantages: Easy to interpret, handles non-linear relationships, requires little data preprocessing
- Disadvantages: Prone to overfitting, unstable (small data changes affect tree structure)
- Pruning: Pre-pruning (early stopping) and post-pruning to prevent overfitting
- Parameters: Max depth, min samples split, min samples leaf

4. Random Forest:
- Use Case: High accuracy classification/regression, feature importance, anomaly detection
- How it Works: Ensemble of decision trees trained on random subsets with random features
- Bootstrap Aggregating (Bagging): Each tree trained on random sample with replacement
- Random Feature Selection: Each split considers random subset of features
- Advantages: Reduces overfitting, robust to outliers, provides feature importance
- Disadvantages: Less interpretable than single tree, computationally expensive
- Hyperparameters: Number of trees, max features, max depth, min samples split
- Out-of-Bag Error: Built-in validation using samples not in bootstrap sample

5. Support Vector Machines (SVM):
- Use Case: Text classification, image recognition, bioinformatics
- How it Works: Finds optimal hyperplane that maximizes margin between classes
- Kernel Trick: Maps data to higher dimensions for non-linear separation
- Common Kernels: Linear, Polynomial, Radial Basis Function (RBF), Sigmoid
- Advantages: Effective in high-dimensional spaces, memory efficient, versatile with kernels
- Disadvantages: Slow with large datasets, sensitive to feature scaling, choosing right kernel is crucial
- Parameters: C (regularization), kernel type, gamma (kernel coefficient)
- Support Vectors: Training examples that lie on the margin boundaries

6. K-Nearest Neighbors (KNN):
- Use Case: Recommendation systems, pattern recognition, missing value imputation
- How it Works: Classifies based on majority vote of K nearest training examples
- Distance Metrics: Euclidean, Manhattan, Minkowski, Cosine similarity
- Advantages: Simple, no training phase, naturally handles multi-class problems
- Disadvantages: Computationally expensive for large datasets, sensitive to irrelevant features
- Choosing K: Small K is noisy, large K is smooth; typically use cross-validation
- Curse of Dimensionality: Performance degrades in high dimensions

7. Naive Bayes:
- Use Case: Text classification, spam filtering, sentiment analysis, medical diagnosis
- How it Works: Applies Bayes theorem with naive independence assumption: P(Y|X) = P(X|Y)P(Y)/P(X)
- Variants: Gaussian NB (continuous), Multinomial NB (discrete counts), Bernoulli NB (binary)
- Advantages: Fast, works well with small datasets, handles high-dimensional data
- Disadvantages: Independence assumption rarely holds, poor probability estimates
- Applications: Document classification, real-time prediction

8. Neural Networks:
- Use Case: Complex pattern recognition, computer vision, speech recognition, NLP
- Architecture: Input layer → Hidden layers → Output layer
- Activation Functions: ReLU, Sigmoid, Tanh, Softmax
- Forward Propagation: Compute predictions through network
- Backpropagation: Update weights using gradient descent
- Advantages: Learns complex non-linear relationships, universal function approximator
- Disadvantages: Requires large data, computationally expensive, black box nature
- Hyperparameters: Learning rate, number of layers, neurons per layer, batch size, epochs
- Regularization: Dropout, L1/L2 regularization, early stopping, batch normalization

Training Process:
1. Data Preparation: Split into training, validation, and test sets (e.g., 70-15-15)
2. Feature Engineering: Select, transform, and create relevant features
3. Model Selection: Choose algorithm based on problem characteristics
4. Training: Fit model on training data
5. Validation: Tune hyperparameters using validation set
6. Testing: Evaluate final model on test set
7. Deployment: Deploy model to production

Evaluation Metrics:
Classification:
- Accuracy: Overall correctness
- Precision: TP/(TP+FP) - How many predicted positives are correct
- Recall (Sensitivity): TP/(TP+FN) - How many actual positives were found
- F1-Score: Harmonic mean of precision and recall
- ROC Curve & AUC: Trade-off between true positive and false positive rates
- Confusion Matrix: Detailed breakdown of predictions

Regression:
- Mean Absolute Error (MAE): Average absolute difference
- Mean Squared Error (MSE): Average squared difference
- Root Mean Squared Error (RMSE): Square root of MSE
- R² Score: Proportion of variance explained
- Adjusted R²: R² adjusted for number of features

Common Challenges:
- Overfitting: Model too complex, fits training data too closely
- Underfitting: Model too simple, fails to capture patterns
- Class Imbalance: Unequal distribution of classes
- Feature Scaling: Different feature ranges affect some algorithms
- Multicollinearity: Correlated features cause issues
- Outliers: Extreme values affect model training

Best Practices:
- Always validate on unseen data
- Use cross-validation for robust evaluation
- Apply feature scaling where necessary
- Handle missing values appropriately
- Monitor for overfitting using validation curves
- Consider ensemble methods for better performance
- Document model assumptions and limitations`,
    metadata: { topic: 'supervised_learning', category: 'algorithms', difficulty: 'intermediate' }
  },
  {
    id: 5,
    content: `Unsupervised Learning - Comprehensive Guide:

Overview:
Unsupervised learning works with unlabeled data to discover hidden patterns, structures, or relationships without predefined output labels. The algorithm explores data to find interesting patterns, groupings, or representations.

Core Objectives:
- Clustering: Group similar data points together
- Dimensionality Reduction: Reduce number of features while preserving information
- Density Estimation: Model probability distribution of data
- Anomaly Detection: Identify unusual or rare patterns
- Association Rule Learning: Discover relationships between variables

Key Algorithms in Detail:

1. K-Means Clustering:
- Use Case: Customer segmentation, image compression, document clustering, market basket analysis
- How it Works: Partitions data into K clusters by minimizing within-cluster variance
- Algorithm Steps:
  1. Initialize K centroids randomly
  2. Assign each point to nearest centroid
  3. Recalculate centroids as mean of assigned points
  4. Repeat until convergence
- Distance Metric: Typically Euclidean distance
- Choosing K: Elbow method, Silhouette score, Gap statistic
- Advantages: Simple, fast, scales well to large datasets
- Disadvantages: Must specify K beforehand, sensitive to initialization, assumes spherical clusters
- Variations: K-Means++, Mini-Batch K-Means, K-Medoids
- Limitations: Struggles with non-globular clusters, different sizes, varying densities

2. Hierarchical Clustering:
- Use Case: Taxonomy creation, gene sequencing, social network analysis
- Types:
  - Agglomerative (Bottom-up): Start with individual points, merge closest pairs
  - Divisive (Top-down): Start with all points, recursively split
- Linkage Methods:
  - Single: Minimum distance between clusters
  - Complete: Maximum distance between clusters
  - Average: Average distance between all pairs
  - Ward: Minimizes within-cluster variance
- Output: Dendrogram showing hierarchical relationships
- Advantages: No need to specify number of clusters, produces hierarchy, deterministic
- Disadvantages: Computationally expensive O(n³), doesn't scale to large datasets
- Applications: Biology (phylogenetic trees), document organization, image segmentation

3. DBSCAN (Density-Based Spatial Clustering):
- Use Case: Geospatial analysis, anomaly detection, clusters of arbitrary shapes
- How it Works: Groups points that are closely packed together, marking outliers
- Key Parameters:
  - ε (epsilon): Maximum distance between two points in same neighborhood
  - MinPts: Minimum number of points to form dense region
- Point Types:
  - Core points: Have MinPts neighbors within ε
  - Border points: Within ε of core point but not core themselves
  - Noise points: Neither core nor border (outliers)
- Advantages: Finds arbitrary-shaped clusters, identifies outliers, doesn't require K
- Disadvantages: Sensitive to parameters, struggles with varying densities
- Variations: HDBSCAN (hierarchical), OPTICS (ordering points)

4. Principal Component Analysis (PCA):
- Use Case: Dimensionality reduction, visualization, noise filtering, feature extraction
- How it Works: Projects data onto orthogonal axes that maximize variance
- Mathematical Foundation:
  - Computes covariance matrix of features
  - Finds eigenvectors (principal components) and eigenvalues
  - Projects data onto top K eigenvectors
- Explained Variance: Amount of information retained by each component
- Advantages: Reduces dimensions, removes correlations, speeds up training
- Disadvantages: Linear transformation only, components hard to interpret, sensitive to scaling
- Applications: Image compression, exploratory data analysis, preprocessing for ML
- Variations: Kernel PCA (non-linear), Sparse PCA, Incremental PCA

5. t-SNE (t-Distributed Stochastic Neighbor Embedding):
- Use Case: Visualizing high-dimensional data in 2D/3D, exploratory analysis
- How it Works: Preserves local structure by modeling pairwise similarities
- Algorithm:
  1. Compute pairwise similarities in high-dimensional space (Gaussian)
  2. Initialize low-dimensional embedding randomly
  3. Compute pairwise similarities in low dimensions (t-distribution)
  4. Optimize embedding to match similarities using gradient descent
- Perplexity Parameter: Balance between local and global structure (typically 5-50)
- Advantages: Excellent visualization, reveals local structure and clusters
- Disadvantages: Computationally expensive, non-deterministic, distances not meaningful
- Best Practices: Run multiple times, don't use for anything except visualization
- Alternative: UMAP (faster, preserves global structure better)

6. Autoencoders:
- Use Case: Dimensionality reduction, feature learning, denoising, anomaly detection
- Architecture: Neural network with encoder-decoder structure
- Components:
  - Encoder: Compresses input to lower-dimensional latent representation
  - Latent Space: Compressed representation (bottleneck)
  - Decoder: Reconstructs input from latent representation
- Loss Function: Reconstruction error (e.g., MSE between input and output)
- Types:
  - Vanilla Autoencoder: Basic compression
  - Denoising Autoencoder: Learns to remove noise
  - Sparse Autoencoder: Encourages sparse activations
  - Variational Autoencoder (VAE): Learns probabilistic latent space
- Advantages: Non-linear, learns task-specific features, flexible architecture
- Disadvantages: Requires neural network training, hyperparameter tuning
- Applications: Image denoising, anomaly detection, generative modeling

7. Gaussian Mixture Models (GMM):
- Use Case: Soft clustering, density estimation, generating synthetic data
- How it Works: Models data as mixture of multiple Gaussian distributions
- Parameters: Means, covariances, and mixing coefficients for each Gaussian
- Expectation-Maximization (EM) Algorithm:
  - E-step: Compute probability each point belongs to each cluster
  - M-step: Update Gaussian parameters based on weighted assignments
- Soft Clustering: Each point has probability of belonging to each cluster
- Advantages: Probabilistic interpretation, handles elliptical clusters, flexible
- Disadvantages: Assumes Gaussian distributions, sensitive to initialization
- Model Selection: Use BIC or AIC to determine number of components

8. Apriori Algorithm (Association Rule Mining):
- Use Case: Market basket analysis, recommendation systems, web usage mining
- Concepts:
  - Itemset: Set of items that appear together
  - Support: Frequency of itemset in dataset
  - Confidence: Likelihood of consequent given antecedent
  - Lift: Strength of association beyond random chance
- Algorithm:
  1. Find frequent itemsets (support > threshold)
  2. Generate association rules from frequent itemsets
  3. Filter rules by confidence and lift
- Example Rule: {bread, butter} → {milk} (confidence 0.8)
- Advantages: Finds hidden patterns, interpretable rules
- Disadvantages: Computationally expensive with many items, generates many rules
- Variations: FP-Growth (faster), ECLAT

9. Isolation Forest:
- Use Case: Anomaly detection in high-dimensional data
- How it Works: Isolates anomalies by randomly partitioning feature space
- Principle: Anomalies are rare and different, easier to isolate
- Algorithm:
  1. Build ensemble of isolation trees
  2. Random feature selection and split point
  3. Anomaly score based on average path length
- Advantages: Fast, scales well, effective for high-dimensional data
- Applications: Fraud detection, network intrusion, quality control

10. Self-Organizing Maps (SOM):
- Use Case: Visualization, clustering, dimensionality reduction
- How it Works: Neural network that maps high-dimensional data to 2D grid
- Training: Competitive learning where neurons compete to represent inputs
- Topology Preservation: Nearby neurons represent similar inputs
- Advantages: Visualize complex relationships, preserve topology
- Applications: Customer analysis, image processing, robotics

Evaluation Metrics:
Clustering:
- Silhouette Score: Measure of cluster cohesion and separation
- Davies-Bouldin Index: Average similarity between clusters
- Calinski-Harabasz Index: Ratio of between-cluster to within-cluster variance
- Dunn Index: Ratio of minimum inter-cluster to maximum intra-cluster distance

Dimensionality Reduction:
- Explained Variance Ratio: Information retained
- Reconstruction Error: Difference between original and reconstructed data
- Trustworthiness and Continuity: Local structure preservation

Common Challenges:
- Determining optimal number of clusters
- Scaling features appropriately
- Handling outliers and noise
- Validating results without ground truth
- Interpreting discovered patterns
- Computational complexity with large datasets

Best Practices:
- Standardize features before clustering
- Try multiple algorithms and compare results
- Use domain knowledge to interpret clusters
- Validate clustering quality with multiple metrics
- Consider hierarchical clustering for exploratory analysis
- Use dimensionality reduction for visualization
- Document assumptions and parameter choices
- Perform sensitivity analysis on key parameters`,
    metadata: { topic: 'unsupervised_learning', category: 'algorithms', difficulty: 'advanced' }
  },
  {
    id: 6,
    content: `Reinforcement Learning - Comprehensive Guide:

Overview:
Reinforcement Learning (RL) is a paradigm where an agent learns to make sequential decisions by interacting with an environment to maximize cumulative reward. Unlike supervised learning with labeled examples, RL learns through trial and error, receiving feedback in the form of rewards or penalties.

Core Components:
- Agent: The learner or decision maker
- Environment: The world the agent interacts with
- State (S): Current situation of the agent
- Action (A): Choices available to the agent
- Reward (R): Feedback signal indicating action quality
- Policy (π): Strategy mapping states to actions
- Value Function (V): Expected cumulative reward from a state
- Model: Agent's representation of environment dynamics

Markov Decision Process (MDP):
- Formal framework for sequential decision making
- Components: (S, A, P, R, γ)
  - S: Set of states
  - A: Set of actions
  - P: State transition probability P(s'|s,a)
  - R: Reward function R(s,a,s')
  - γ: Discount factor (0 ≤ γ ≤ 1)
- Markov Property: Future depends only on current state, not history

Key Concepts:
- Exploration vs Exploitation: Balance discovering new strategies vs using known good ones
- Credit Assignment: Determining which actions led to rewards
- Delayed Gratification: Rewards may come long after crucial actions
- Temporal Difference: Learning from difference between predictions
- Bellman Equation: Recursive relationship for value functions

Key Algorithms in Detail:

1. Q-Learning:
- Type: Model-free, off-policy, value-based
- Use Case: Grid worlds, simple games, discrete action spaces
- How it Works: Learns Q-values Q(s,a) representing expected return of taking action a in state s
- Update Rule: Q(s,a) ← Q(s,a) + α[r + γ max Q(s',a') - Q(s,a)]
- Parameters:
  - α (learning rate): How much to update (typically 0.1-0.5)
  - γ (discount factor): Importance of future rewards (0.9-0.99)
  - ε (epsilon): Exploration rate for ε-greedy policy
- Advantages: Simple, proven convergence, no model required
- Disadvantages: Doesn't scale to continuous/large state spaces, slow convergence
- Applications: Game playing, robot navigation, resource allocation

2. Deep Q-Network (DQN):
- Type: Deep RL, value-based
- Use Case: Atari games, complex state spaces, visual inputs
- Innovation: Combines Q-learning with deep neural networks
- Key Techniques:
  - Experience Replay: Store and sample past experiences randomly
  - Target Network: Separate network for stable target values
  - Frame Stacking: Use multiple consecutive frames as state
- Architecture: Convolutional layers → Fully connected → Q-values for each action
- Loss Function: MSE between predicted and target Q-values
- Advantages: Handles high-dimensional inputs, human-level performance on Atari
- Disadvantages: Sample inefficient, unstable training, overestimates Q-values
- Improvements: Double DQN, Dueling DQN, Prioritized Experience Replay, Rainbow DQN

3. SARSA (State-Action-Reward-State-Action):
- Type: Model-free, on-policy, value-based
- Use Case: When safety matters, conservative strategies preferred
- How it Works: Updates Q-values based on action actually taken (on-policy)
- Update Rule: Q(s,a) ← Q(s,a) + α[r + γQ(s',a') - Q(s,a)]
- Difference from Q-learning: Uses action from policy, not max action
- Advantages: More conservative, learns about actual behavior policy
- Disadvantages: Slower convergence than Q-learning
- Applications: Robotics (safety-critical), adaptive systems

4. Policy Gradient Methods:
- Type: Policy-based, can be on-policy or off-policy
- Use Case: Continuous action spaces, stochastic policies, robotics
- How it Works: Directly optimize policy parameters to maximize expected return
- Objective: J(θ) = E[∑ γᵗ r_t]
- Policy Gradient Theorem: ∇J(θ) = E[∇ log π(a|s,θ) Q(s,a)]
- REINFORCE Algorithm: Monte Carlo policy gradient
- Advantages: Works with continuous actions, can learn stochastic policies, better convergence
- Disadvantages: High variance, sample inefficient, can get stuck in local optima
- Variance Reduction: Use baseline (typically value function)

5. Actor-Critic Methods:
- Type: Hybrid value-based and policy-based
- Use Case: Continuous control, robotics, complex environments
- Architecture:
  - Actor: Policy network that selects actions
  - Critic: Value network that evaluates actions
- How it Works:
  - Critic learns value function (Q or V)
  - Actor updates policy using critic's feedback
  - Advantage Function: A(s,a) = Q(s,a) - V(s) (how much better than average)
- Variants:
  - A2C (Advantage Actor-Critic): Synchronous version
  - A3C (Asynchronous Advantage Actor-Critic): Multiple parallel agents
  - DDPG (Deep Deterministic Policy Gradient): For continuous actions
  - TD3 (Twin Delayed DDPG): Addresses DDPG's overestimation
  - SAC (Soft Actor-Critic): Maximum entropy RL
- Advantages: Lower variance than pure policy gradient, handles continuous actions
- Disadvantages: More complex, requires tuning multiple networks

6. Proximal Policy Optimization (PPO):
- Type: Policy gradient method
- Use Case: Current state-of-the-art for many RL tasks, robotics, game AI
- Innovation: Constrains policy updates to prevent destructive large changes
- Clipped Objective: Limits policy ratio between old and new policies
- Advantages:
  - Stable training (most important)
  - Sample efficient
  - Simple to implement
  - Works well with complex policies (neural networks)
  - Widely used in practice (OpenAI, DeepMind)
- Parameters: Clip epsilon (typically 0.2), number of epochs per batch
- Applications: OpenAI Five (Dota 2), robotics, continuous control

7. Monte Carlo Methods:
- Type: Model-free, learns from complete episodes
- Use Case: Episodic tasks with clear end states
- How it Works:
  - Agent completes full episode
  - Calculate actual returns from each state
  - Update value estimates using actual returns
- First-Visit vs Every-Visit: Update only first time state visited vs every time
- Advantages: Unbiased estimates, simple, no bootstrapping
- Disadvantages: Requires complete episodes, high variance, slow learning
- Applications: Games with clear winners, simulations

8. Temporal Difference (TD) Learning:
- Type: Model-free, learns from incomplete episodes
- Use Case: Continuing tasks without clear episodes
- Innovation: Bootstrap from current estimates (combines Monte Carlo and Dynamic Programming)
- TD(0): Update based on immediate next step
- TD(λ): Eligibility traces for multi-step lookahead
- Advantages: Can learn online, lower variance than Monte Carlo, doesn't need complete episodes
- Disadvantages: Biased estimates (bootstrap), sensitive to initial values
- Applications: Real-time learning, continuous tasks

Training Techniques:
- Epsilon-Greedy: Random action with probability ε, greedy otherwise
- Softmax Action Selection: Probabilistic based on Q-values
- Upper Confidence Bound (UCB): Balance exploration and exploitation
- Curiosity-Driven Exploration: Intrinsic rewards for novel states
- Hindsight Experience Replay: Learn from failed attempts
- Reward Shaping: Add intermediate rewards to guide learning
- Curriculum Learning: Start with easier tasks, gradually increase difficulty

Common Challenges:
- Sparse Rewards: Long periods without feedback
- Credit Assignment: Which actions caused rewards
- Sample Efficiency: Requires many interactions
- Stability: Training can be unstable and diverge
- Partial Observability: Agent doesn't see full state
- Non-Stationarity: Environment or policy changes during learning
- Catastrophic Forgetting: Forgets previous knowledge

Applications:
- Game Playing: Chess, Go, Poker, Video games (AlphaGo, OpenAI Five)
- Robotics: Manipulation, locomotion, navigation, grasping
- Autonomous Vehicles: Driving policies, traffic navigation
- Resource Management: Data center cooling, traffic light control
- Finance: Trading strategies, portfolio optimization
- Healthcare: Treatment policies, drug dosing
- Recommendation Systems: Sequential recommendations
- Natural Language: Dialogue systems, machine translation
- Industrial Control: Manufacturing, energy optimization

Best Practices:
- Start with simple algorithms (DQN, PPO) before complex ones
- Use well-tuned baseline implementations
- Monitor learning curves (rewards, loss, entropy)
- Use proper exploration strategies
- Implement reward clipping and normalization
- Use frame stacking for visual inputs
- Perform hyperparameter tuning systematically
- Test in simulation before real-world deployment
- Consider safety constraints in critical applications
- Use transfer learning when possible`,
    metadata: { topic: 'reinforcement_learning', category: 'algorithms', difficulty: 'advanced' }
  },
  {
    id: 7,
    content: `Deep Learning - Comprehensive Guide:

Overview:
Deep Learning is a subset of machine learning that uses artificial neural networks with multiple layers (deep neural networks) to learn hierarchical representations of data. It has revolutionized AI by achieving human-level or superhuman performance on complex tasks like image recognition, natural language processing, and game playing.

Fundamental Concepts:

Neural Network Architecture:
- Input Layer: Receives raw data (pixels, words, features)
- Hidden Layers: Multiple layers that learn increasingly abstract representations
- Output Layer: Produces final predictions
- Weights and Biases: Learnable parameters connecting neurons
- Depth: Number of layers (deeper = more abstract features)
- Width: Number of neurons per layer

Activation Functions:
- ReLU (Rectified Linear Unit): f(x) = max(0, x)
  - Most popular, solves vanishing gradient, computationally efficient
  - Variants: Leaky ReLU, Parametric ReLU, ELU
- Sigmoid: f(x) = 1/(1+e^(-x))
  - Outputs [0,1], used for binary classification, vanishing gradient problem
- Tanh: f(x) = (e^x - e^(-x))/(e^x + e^(-x))
  - Outputs [-1,1], zero-centered, still has vanishing gradient
- Softmax: Converts logits to probability distribution
  - Used in output layer for multi-class classification
- Swish/SiLU: f(x) = x * sigmoid(x)
  - Smooth, non-monotonic, performs well in deep networks

Training Process:
1. Forward Propagation: Pass input through network to get predictions
2. Loss Calculation: Measure error between predictions and targets
3. Backward Propagation: Calculate gradients using chain rule
4. Parameter Update: Adjust weights using optimization algorithm
5. Repeat for multiple epochs until convergence

Loss Functions:
- Mean Squared Error (MSE): Regression tasks
- Cross-Entropy: Classification (binary and multi-class)
- Hinge Loss: Support vector machines, margin-based
- Huber Loss: Robust to outliers, combines MSE and MAE
- Custom Losses: Task-specific objectives

Optimization Algorithms:
- Stochastic Gradient Descent (SGD): Simple, requires learning rate tuning
- Momentum: Accelerates SGD in relevant directions
- AdaGrad: Adaptive learning rates per parameter
- RMSprop: Addresses AdaGrad's learning rate decay
- Adam: Combines momentum and RMSprop, most popular
- AdamW: Adam with decoupled weight decay
- Learning Rate Scheduling: Decay, warm-up, cyclic, cosine annealing

Key Architectures in Detail:

1. Convolutional Neural Networks (CNN):
- Use Case: Image classification, object detection, segmentation, video analysis
- Key Components:
  - Convolutional Layers: Apply filters to detect features (edges, textures, patterns)
  - Pooling Layers: Reduce spatial dimensions (max pooling, average pooling)
  - Fully Connected Layers: Final classification
- Convolution Operation: Slide filter over input, compute dot product
- Filters: Learn hierarchical features (edges → textures → parts → objects)
- Receptive Field: Region of input that affects a neuron
- Famous Architectures:
  - LeNet-5: Early CNN for digit recognition
  - AlexNet: 2012 ImageNet winner, started deep learning revolution
  - VGGNet: Very deep with small 3x3 filters
  - ResNet: Skip connections solve vanishing gradient, enables very deep networks
  - Inception: Multi-scale processing with parallel paths
  - EfficientNet: Optimal scaling of depth, width, resolution
  - Vision Transformer (ViT): Applies transformers to images
- Advantages: Translation invariance, parameter sharing, hierarchical features
- Applications: Medical imaging, facial recognition, autonomous driving, satellite imagery

2. Recurrent Neural Networks (RNN):
- Use Case: Sequential data, time series, natural language, speech
- How it Works: Maintains hidden state that captures information from previous steps
- Architecture: h_t = f(W_hh * h_{t-1} + W_xh * x_t + b_h)
- Types:
  - Vanilla RNN: Simple recurrence, vanishing/exploding gradient issues
  - Bidirectional RNN: Processes sequence forward and backward
  - Deep RNN: Multiple stacked RNN layers
- Advantages: Handles variable-length sequences, shares parameters across time
- Disadvantages: Vanishing/exploding gradients, difficulty learning long-range dependencies
- Training: Backpropagation Through Time (BPTT)
- Applications: Language modeling, machine translation, speech recognition, music generation

3. Long Short-Term Memory (LSTM):
- Use Case: Long sequences, overcoming RNN limitations
- Innovation: Gating mechanisms control information flow
- Components:
  - Forget Gate: Decides what information to discard from cell state
  - Input Gate: Decides what new information to store
  - Output Gate: Decides what to output based on cell state
  - Cell State: Long-term memory that flows through network
- Equations:
  - f_t = σ(W_f * [h_{t-1}, x_t] + b_f)  # Forget gate
  - i_t = σ(W_i * [h_{t-1}, x_t] + b_i)  # Input gate
  - o_t = σ(W_o * [h_{t-1}, x_t] + b_o)  # Output gate
  - c_t = f_t * c_{t-1} + i_t * tanh(W_c * [h_{t-1}, x_t] + b_c)
- Advantages: Learns long-range dependencies, solves vanishing gradient
- Disadvantages: More parameters, slower than simple RNN
- Variant: GRU (Gated Recurrent Unit) - Simpler with fewer gates
- Applications: Sentiment analysis, machine translation, video captioning

4. Transformers:
- Use Case: State-of-the-art for NLP, now used in vision and other domains
- Innovation: Self-attention mechanism processes entire sequence in parallel
- Key Components:
  - Self-Attention: Computes relevance of all positions to each position
  - Multi-Head Attention: Multiple attention mechanisms in parallel
  - Position Encoding: Adds sequence position information
  - Feed-Forward Networks: Applied to each position independently
  - Layer Normalization: Stabilizes training
  - Residual Connections: Enables deep stacking
- Attention Mechanism:
  - Query (Q), Key (K), Value (V) matrices
  - Attention(Q,K,V) = softmax(QK^T/√d_k)V
  - Learns which parts of input to focus on
- Advantages:
  - Parallelizable (faster training than RNN)
  - Better long-range dependencies than LSTM
  - Transfer learning through pre-training
- Famous Models:
  - BERT: Bidirectional encoder, masked language modeling
  - GPT: Autoregressive decoder, text generation
  - T5: Text-to-text framework
  - Vision Transformer (ViT): Patches images for sequence processing
- Applications: Machine translation, question answering, text generation, summarization

5. Generative Adversarial Networks (GAN):
- Use Case: Generating realistic images, data augmentation, style transfer
- Architecture: Two neural networks in competition
  - Generator: Creates fake data from random noise
  - Discriminator: Distinguishes real from fake data
- Training Process:
  - Generator tries to fool discriminator
  - Discriminator tries to correctly classify real vs fake
  - Min-max game reaches Nash equilibrium
- Loss Functions:
  - Discriminator: Maximize log D(x) + log(1 - D(G(z)))
  - Generator: Minimize log(1 - D(G(z)))
- Variants:
  - DCGAN: Uses convolutional layers
  - StyleGAN: Controls style at different scales, photorealistic faces
  - CycleGAN: Unpaired image-to-image translation
  - Pix2Pix: Paired image translation
  - BigGAN: Large-scale high-quality image generation
- Challenges:
  - Training instability (mode collapse, vanishing gradients)
  - Requires careful hyperparameter tuning
  - Difficult to evaluate quality objectively
- Applications: Face generation, image editing, super-resolution, art creation, drug discovery

6. Autoencoders (Deep Learning Version):
- Use Case: Dimensionality reduction, denoising, anomaly detection, generative modeling
- Architecture:
  - Encoder: Compresses input to latent representation
  - Decoder: Reconstructs input from latent code
  - Bottleneck: Forces learning of compressed representation
- Types:
  - Vanilla Autoencoder: Basic reconstruction
  - Denoising Autoencoder: Learns robust features by removing noise
  - Sparse Autoencoder: Enforces sparsity in hidden layer
  - Variational Autoencoder (VAE): Learns probabilistic latent space
  - Contractive Autoencoder: Robust to small input perturbations
- VAE Details:
  - Encodes to mean and variance of distribution
  - Samples latent vector using reparameterization trick
  - Loss = Reconstruction loss + KL divergence
  - Enables generation of new samples
- Applications: Image compression, feature extraction, anomaly detection, drug design

7. ResNet (Residual Networks):
- Use Case: Very deep networks (50-1000+ layers)
- Innovation: Skip connections (residual connections)
- Residual Block: F(x) + x instead of just F(x)
- Why it Works:
  - Solves vanishing gradient problem
  - Allows identity mapping (network can learn to skip layers if needed)
  - Easier to optimize very deep networks
- Variants: ResNeXt, Wide ResNet, DenseNet
- Applications: Image classification, object detection, segmentation

8. U-Net:
- Use Case: Image segmentation (medical imaging, satellite images)
- Architecture:
  - Encoder: Contracting path (downsampling)
  - Decoder: Expanding path (upsampling)
  - Skip Connections: Concatenate encoder features to decoder
- Why it Works:
  - Combines high-resolution features with semantic information
  - Preserves spatial information through skip connections
  - Works well with small datasets
- Applications: Medical image segmentation, cell tracking, object detection

Regularization Techniques:
- Dropout: Randomly drop neurons during training
- Batch Normalization: Normalize layer inputs, reduces internal covariate shift
- Layer Normalization: Normalizes across features
- Weight Decay (L2): Penalizes large weights
- Data Augmentation: Artificially expand training data
- Early Stopping: Stop when validation performance plateaus
- Label Smoothing: Soften target labels to prevent overconfidence
- Mixup: Train on linear combinations of examples
- Cutout/Random Erasing: Mask random patches in images

Advanced Techniques:
- Transfer Learning: Use pre-trained models, fine-tune on new task
- Multi-Task Learning: Train single model on multiple related tasks
- Meta-Learning: Learn to learn, few-shot learning
- Neural Architecture Search: Automatically discover architectures
- Knowledge Distillation: Transfer knowledge from large to small model
- Federated Learning: Train on distributed data without centralizing
- Self-Supervised Learning: Create supervisory signal from data itself
- Contrastive Learning: Learn by comparing similar vs dissimilar examples

Hardware and Frameworks:
- GPUs: NVIDIA (CUDA), AMD (ROCm)
- TPUs: Google's specialized chips
- Frameworks: PyTorch, TensorFlow, JAX, Keras
- Distributed Training: Data parallelism, model parallelism
- Mixed Precision Training: Use FP16 for speed, FP32 for accuracy

Applications:
- Computer Vision: Classification, detection, segmentation, tracking, 3D reconstruction
- Natural Language Processing: Translation, summarization, QA, generation, sentiment
- Speech: Recognition, synthesis, enhancement, separation
- Reinforcement Learning: Game playing, robotics, control
- Healthcare: Disease diagnosis, drug discovery, treatment planning
- Autonomous Systems: Self-driving cars, drones, robots
- Creative: Art generation, music composition, video synthesis
- Science: Protein folding, climate modeling, particle physics

Best Practices:
- Start with established architectures and pre-trained models
- Use appropriate data augmentation for your domain
- Monitor training carefully (loss curves, gradients, activations)
- Use validation set to tune hyperparameters
- Apply regularization to prevent overfitting
- Use batch normalization for faster, more stable training
- Implement gradient clipping for stability
- Save checkpoints regularly
- Use tensorboard or wandb for experiment tracking
- Test on diverse, representative data
- Consider computational budget and deployment constraints
- Document architecture choices and results`,
    metadata: { topic: 'deep_learning', category: 'algorithms', difficulty: 'advanced' }
  },
  {
    id: 8,
    content: `Ensemble Methods - Comprehensive Guide:

Overview:
Ensemble methods combine predictions from multiple machine learning models to create a more robust and accurate final prediction. The key principle is "wisdom of crowds" - combining diverse models often outperforms any single model. Ensemble methods are among the most powerful techniques in machine learning and dominate many real-world applications and competitions.

Core Principles:
- Diversity: Individual models should make different types of errors
- Independence: Models trained on different data or with different algorithms
- Aggregation: Combine predictions through voting, averaging, or stacking
- Bias-Variance Tradeoff: Reduce variance (bagging) or bias (boosting)

Why Ensembles Work:
- Error Cancellation: Individual model errors cancel out when averaged
- Robustness: Less sensitive to outliers and noise
- Generalization: Better performance on unseen data
- Reduced Overfitting: Aggregation smooths predictions

Key Techniques in Detail:

1. Bagging (Bootstrap Aggregating):
- Use Case: Reducing variance of unstable models (decision trees)
- How it Works:
  1. Create multiple bootstrap samples (random sampling with replacement)
  2. Train separate model on each sample
  3. Aggregate predictions (voting for classification, averaging for regression)
- Bootstrap Sample: Random sample of same size as original, ~63% unique instances
- Mathematical Foundation:
  - If models are independent with error ε
  - Ensemble error ≈ ε/√n where n is number of models
- Advantages:
  - Reduces variance without increasing bias
  - Parallelizable training
  - Handles outliers well
  - Reduces overfitting
- Disadvantages:
  - Doesn't help with bias
  - Less interpretable than single model
  - More computational resources
- Out-of-Bag (OOB) Estimation:
  - ~37% samples not in each bootstrap used for validation
  - Free cross-validation without separate test set
- Applications: Random Forest, medical diagnosis, financial forecasting

2. Boosting:
- Use Case: Reducing bias, improving weak learners
- Core Idea: Sequentially train models, each focusing on previous errors
- How it Works:
  1. Train initial model on data
  2. Increase weight of misclassified examples
  3. Train next model on reweighted data
  4. Repeat, combining all models with weighted voting
- Key Difference from Bagging: Sequential training, focus on hard examples
- Advantages:
  - Reduces bias and variance
  - Often achieves better accuracy than bagging
  - Can use simple weak learners
  - Feature importance available
- Disadvantages:
  - Prone to overfitting with noise
  - Not parallelizable (sequential)
  - Sensitive to outliers
  - Requires careful tuning
- Variants: AdaBoost, Gradient Boosting, XGBoost, LightGBM, CatBoost

3. AdaBoost (Adaptive Boosting):
- Use Case: Binary classification, face detection, text classification
- Innovation: First practical boosting algorithm
- Algorithm:
  1. Initialize equal weights for all samples: w_i = 1/n
  2. For each iteration t:
     a. Train weak learner on weighted data
     b. Calculate error: ε_t = Σ w_i * I(y_i ≠ h_t(x_i))
     c. Calculate model weight: α_t = 0.5 * ln((1-ε_t)/ε_t)
     d. Update sample weights: w_i = w_i * exp(-α_t * y_i * h_t(x_i))
     e. Normalize weights
  3. Final prediction: H(x) = sign(Σ α_t * h_t(x))
- Weak Learners: Usually decision stumps (one-level decision trees)
- Advantages:
  - Simple to implement
  - No hyperparameter tuning needed
  - Fast training with simple weak learners
  - Good for binary classification
- Disadvantages:
  - Sensitive to noisy data and outliers
  - Can overfit if too many iterations
  - Requires careful stopping criteria
- Applications: Face detection (Viola-Jones), binary classification, anomaly detection

4. Gradient Boosting:
- Use Case: State-of-the-art for tabular data, Kaggle competitions
- Innovation: Fits new models to residual errors using gradient descent
- How it Works:
  1. Initialize model with constant prediction
  2. For each iteration:
     a. Calculate residuals (negative gradient of loss)
     b. Fit new tree to residuals
     c. Add tree to ensemble with learning rate η
  3. Final prediction: F(x) = F_0(x) + η * Σ h_t(x)
- Loss Functions:
  - Regression: MSE, MAE, Huber
  - Classification: Log loss, exponential loss
  - Custom: Task-specific objectives
- Hyperparameters:
  - n_estimators: Number of trees (100-1000)
  - learning_rate: Shrinkage factor (0.01-0.3)
  - max_depth: Tree depth (3-10)
  - min_samples_split: Minimum samples for split
  - subsample: Fraction of samples for each tree
- Regularization:
  - Learning rate: Smaller = more trees needed but better generalization
  - Tree depth: Shallower trees prevent overfitting
  - Subsampling: Stochastic gradient boosting
- Advantages:
  - Excellent predictive accuracy
  - Handles mixed data types
  - Built-in feature importance
  - Robust to outliers with appropriate loss
- Disadvantages:
  - Prone to overfitting
  - Requires careful tuning
  - Sequential training (not parallelizable)
  - Sensitive to hyperparameters
- Applications: Ranking, click-through rate prediction, price estimation

5. XGBoost (Extreme Gradient Boosting):
- Use Case: Industry standard for structured/tabular data
- Innovation: Optimized implementation with regularization and engineering tricks
- Key Features:
  - Regularized Learning: L1 (Lasso) and L2 (Ridge) regularization
  - Sparsity Awareness: Handles missing values internally
  - Weighted Quantile Sketch: Efficient split finding
  - Cross-validation: Built-in CV for early stopping
  - Parallel Processing: Parallelized tree construction
  - Cache Optimization: Hardware-aware design
  - Out-of-Core Computing: Handles data larger than memory
- Objective Function: L(θ) = Σ l(y_i, ŷ_i) + Σ Ω(f_k)
  - Loss term + Regularization term
- Tree Pruning: Max depth then prune back (vs grow until criteria)
- Advantages:
  - Best-in-class performance on tabular data
  - Fast training and prediction
  - Handles missing values
  - Built-in regularization prevents overfitting
  - Feature importance and SHAP values
  - Extensive tuning options
- Hyperparameters:
  - Learning rate: 0.01-0.3
  - Max depth: 3-10
  - Subsample: 0.5-1.0
  - Colsample_bytree: 0.3-1.0
  - Lambda (L2): 0-10
  - Alpha (L1): 0-10
- Applications: Click prediction, anomaly detection, ranking, most Kaggle winners

6. LightGBM (Light Gradient Boosting Machine):
- Use Case: Large datasets, fast training, high-dimensional data
- Innovation: Histogram-based learning and leaf-wise growth
- Key Features:
  - Histogram-Based: Bins continuous features (faster split finding)
  - Leaf-Wise Growth: Grows tree by best leaf (vs level-wise)
  - GOSS (Gradient-Based One-Side Sampling): Keeps large gradient samples
  - EFB (Exclusive Feature Bundling): Reduces feature dimensions
  - Direct Categorical Support: Handles categorical features without encoding
- Advantages:
  - Faster training than XGBoost (3-15x)
  - Lower memory usage
  - Better accuracy on some datasets
  - Handles large datasets efficiently
  - Built-in categorical feature support
- Disadvantages:
  - Can overfit small datasets
  - Leaf-wise growth more prone to overfitting
  - Requires more careful tuning
- Hyperparameters:
  - Num_leaves: 20-300 (more important than max_depth)
  - Learning_rate: 0.01-0.3
  - Feature_fraction: 0.5-1.0
  - Bagging_fraction: 0.5-1.0
  - Min_data_in_leaf: 20-100
- Applications: Click-through rate, recommendation systems, financial modeling

7. CatBoost (Categorical Boosting):
- Use Case: Datasets with many categorical features
- Innovation: Ordered boosting and optimal handling of categorical features
- Key Features:
  - Ordered Boosting: Reduces prediction shift and overfitting
  - Categorical Features: Efficient encoding without preprocessing
  - Symmetric Trees: Balanced tree structure
  - Minimal Hyperparameter Tuning: Good defaults
  - GPU Support: Fast training on GPUs
  - Robust to Overfitting: Built-in regularization
- Categorical Encoding:
  - Target encoding with regularization
  - Handles high-cardinality categories
  - No need for one-hot encoding
- Advantages:
  - Best for categorical-heavy datasets
  - Less prone to overfitting
  - Requires minimal tuning
  - Produces readable models
  - Good out-of-the-box performance
- Disadvantages:
  - Slower than LightGBM on some datasets
  - Higher memory usage
  - Fewer tuning options
- Applications: Recommendation systems, e-commerce, categorical prediction tasks

8. Stacking (Stacked Generalization):
- Use Case: Kaggle competitions, maximum performance scenarios
- How it Works:
  1. Level 0: Train multiple diverse base models
  2. Generate predictions on validation/test set
  3. Level 1: Train meta-model on base model predictions
  4. Final prediction from meta-model
- Base Models (Level 0):
  - Should be diverse (different algorithms, hyperparameters)
  - Random Forest, XGBoost, Neural Networks, SVM, etc.
  - Each trained on same data
- Meta-Model (Level 1):
  - Usually simple: Linear Regression, Logistic Regression
  - Can be complex: Neural Network, XGBoost
  - Learns optimal way to combine base predictions
- Cross-Validation:
  - Use CV to generate out-of-fold predictions
  - Prevents overfitting to training data
  - Essential for proper stacking
- Multi-Level Stacking:
  - Can have multiple meta-levels
  - Level 2, 3, etc. stack on previous levels
  - Diminishing returns after 2-3 levels
- Advantages:
  - Often best possible performance
  - Combines strengths of different algorithms
  - Flexible and powerful
- Disadvantages:
  - Complex to implement and maintain
  - Computationally expensive
  - Requires careful CV to avoid overfitting
  - Hard to interpret
  - Longer training time
- Applications: Kaggle competitions, critical prediction tasks, research

9. Voting Ensembles:
- Types:
  - Hard Voting: Majority vote (classification)
  - Soft Voting: Average probabilities (classification)
  - Averaging: Mean predictions (regression)
  - Weighted Voting: Different model weights
- Use Case: Simple, effective ensemble for diverse models
- Advantages:
  - Simple to implement
  - No additional training
  - Reduces variance
- Best Practices:
  - Use diverse models
  - Tune individual models first
  - Use soft voting when possible
  - Consider weighted voting based on validation performance

10. Blending:
- Similar to stacking but simpler
- Hold out validation set for meta-model training
- Base models trained on training set
- Meta-model trained on holdout predictions
- Simpler than stacking but uses less data

Ensemble Design Strategies:
- Algorithm Diversity: Mix tree-based, linear, neural networks
- Data Diversity: Bootstrap, feature subsampling, sample weighting
- Hyperparameter Diversity: Different configurations of same algorithm
- Architecture Diversity: Different model structures
- Training Diversity: Different random seeds, initialization

Best Practices:
1. Start Simple: Try bagging/boosting before complex stacking
2. Ensure Diversity: Models should make different errors
3. Tune Individual Models: Good base models make good ensembles
4. Use Proper Cross-Validation: Prevent overfitting
5. Monitor Correlation: Lower correlation between models is better
6. Balance Complexity vs Performance: Diminishing returns
7. Consider Deployment: More models = higher latency/cost
8. Feature Engineering: Still crucial for ensemble performance
9. Early Stopping: Prevent overfitting in boosting
10. Track Experiments: Log all configurations and results

Common Pitfalls:
- Overfitting validation set through excessive tuning
- Including highly correlated models
- Not using proper CV for stacking
- Ignoring computational constraints
- Over-complicating with too many levels
- Neglecting individual model performance

Applications by Domain:
- Finance: Credit scoring, fraud detection, trading
- Healthcare: Disease prediction, risk assessment
- E-commerce: Recommendation, churn prediction, pricing
- Marketing: Customer segmentation, response modeling
- Manufacturing: Quality control, predictive maintenance
- Insurance: Risk assessment, claim prediction
- Web: Click-through rate, search ranking, ad targeting

Evaluation:
- Compare single model vs ensemble performance
- Analyze diversity metrics between models
- Test on truly unseen data
- Monitor performance in production
- A/B test against existing solutions
- Consider inference time and resources`,
    metadata: { topic: 'ensemble_methods', category: 'algorithms', difficulty: 'advanced' }
  },
  {
    id: 9,
    content: `Feature Engineering and Data Preprocessing:

Overview:
Feature engineering is the process of creating, transforming, and selecting features to improve model performance. It's often said that "applied machine learning is basically feature engineering" - even the best algorithms perform poorly with bad features, while good features can make simple models work well.

Data Collection and Understanding:
- Domain Knowledge: Understand the problem and data context
- Exploratory Data Analysis (EDA): Visualize distributions, correlations, patterns
- Data Quality Assessment: Check for errors, inconsistencies, biases
- Data Documentation: Understand what each feature represents
- Statistical Analysis: Mean, median, variance, skewness, kurtosis

Data Cleaning:

1. Handling Missing Values:
- Detection: Identify missing, null, NaN, empty values
- Patterns: Missing completely at random (MCAR), at random (MAR), not at random (MNAR)
- Strategies:
  - Deletion: Remove rows/columns (when <5% missing)
  - Mean/Median Imputation: Replace with central tendency
  - Mode Imputation: For categorical variables
  - Forward/Backward Fill: For time series
  - Interpolation: Linear, polynomial, spline
  - Model-Based: Predict missing values using other features
  - Multiple Imputation: Create multiple complete datasets
  - Indicator Variable: Add binary feature indicating missingness
- Best Practice: Understand why data is missing before choosing method

2. Outlier Detection and Treatment:
- Detection Methods:
  - Statistical: Z-score (>3), IQR (Q1-1.5*IQR, Q3+1.5*IQR)
  - Visualization: Box plots, scatter plots
  - Distance-Based: Isolation Forest, LOF, DBSCAN
  - Model-Based: Residual analysis
- Treatment Options:
  - Remove: If data errors or extreme anomalies
  - Cap/Winsorize: Replace with threshold values
  - Transform: Log, sqrt to reduce impact
  - Binning: Group into categories
  - Separate Model: Create special handling for outliers
  - Keep: If legitimate extreme values
- Domain Consideration: Outliers may be most interesting cases (fraud, defects)

3. Data Type Corrections:
- Ensure correct types: numeric, categorical, datetime, boolean
- Parse dates: Extract year, month, day, day of week, is_weekend
- Convert strings to appropriate types
- Handle mixed-type columns
- Standardize formats (dates, phone numbers, addresses)

Feature Encoding:

1. Categorical Encoding:
- One-Hot Encoding:
  - Create binary column for each category
  - Use when: Low cardinality (<10-20 categories), no ordinal relationship
  - Pros: Simple, no ordinal assumption
  - Cons: High dimensionality with many categories, sparse matrices
- Label Encoding:
  - Map categories to integers 0, 1, 2, ...
  - Use when: Ordinal relationships (low, medium, high) or tree-based models
  - Pros: Compact, single column
  - Cons: Implies ordering for linear models
- Ordinal Encoding:
  - Manual mapping respecting order (e.g., education levels)
  - Use when: Clear ordering exists
- Target Encoding:
  - Replace category with mean target value
  - Pros: Handles high cardinality, captures predictive power
  - Cons: Risk of overfitting, needs regularization
  - Best with: Cross-validation, smoothing, regularization
- Frequency Encoding:
  - Replace with category frequency
  - Useful for high-cardinality features
- Binary Encoding:
  - Convert to binary, each bit becomes feature
  - Compact representation for high cardinality
- Hash Encoding:
  - Hash categories to fixed number of buckets
  - Handles new categories, memory efficient

2. Numerical Transformations:
- Scaling/Normalization:
  - Min-Max Scaling: [0,1] range, x' = (x-min)/(max-min)
  - Standardization (Z-score): Mean=0, SD=1, x' = (x-μ)/σ
  - Robust Scaling: Uses median and IQR, resistant to outliers
  - Max Abs Scaling: [-1,1] range, preserves sparsity
  - When to use: Distance-based algorithms (KNN, SVM, Neural Networks)
- Log Transform:
  - Handles right-skewed distributions
  - log(x+1) to handle zeros
  - Use when: Power-law distributions, multiplicative relationships
- Power Transforms:
  - Box-Cox: Requires positive values, λ parameter
  - Yeo-Johnson: Works with negative values
  - Square root, cube root
- Binning/Discretization:
  - Equal-width: Divide range into equal intervals
  - Equal-frequency: Same number of samples per bin
  - Custom: Domain-specific boundaries
  - Benefits: Handles outliers, non-linear relationships, interpretability

3. Text Feature Encoding:
- Bag of Words (BoW): Count word occurrences
- TF-IDF: Term frequency - Inverse document frequency
- Word Embeddings: Word2Vec, GloVe, FastText
- Contextual Embeddings: BERT, GPT, ELMo
- N-grams: Capture word sequences
- Character-level: For typos, unknown words

4. Date/Time Features:
- Extract Components: Year, month, day, hour, minute, second
- Derived Features:
  - Day of week, is_weekend, is_holiday
  - Quarter, week of year
  - Time since event, time until event
  - Cyclical encoding: sin/cos for hour, month (preserves cyclical nature)
  - Business days vs calendar days
  - Time differences between events

Feature Creation:

1. Domain-Specific Features:
- E-commerce: Cart value, items per order, purchase frequency
- Finance: Moving averages, volatility, ratios
- Healthcare: BMI, age groups, risk scores
- Text: Sentiment, readability, named entities
- Images: Edges, textures, color histograms

2. Interaction Features:
- Multiplication: price * quantity
- Division: revenue / cost
- Addition/Subtraction: feature_a - feature_b
- Polynomial Features: x², x³, x*y, x²y
- Ratios: feature_a / (feature_a + feature_b)

3. Aggregation Features:
- Group-by statistics: mean, median, std, min, max per group
- Time windows: rolling mean, cumulative sum
- Count encodings: number of occurrences
- Rank features: within-group ranking

4. Statistical Features:
- Percentiles, quantiles
- Skewness, kurtosis
- Correlation-based features
- Distance to cluster centers
- Density estimates

Feature Selection:

1. Filter Methods:
- Correlation: Remove highly correlated features (>0.9)
- Variance Threshold: Remove low-variance features
- Statistical Tests:
  - Chi-square test: Categorical target
  - ANOVA F-test: Numerical features, categorical target
  - Mutual Information: Non-linear relationships
- Advantages: Fast, model-agnostic
- Disadvantages: Ignores feature interactions

2. Wrapper Methods:
- Forward Selection: Start with empty, add best features
- Backward Elimination: Start with all, remove worst
- Recursive Feature Elimination (RFE): Iteratively remove features
- Advantages: Considers feature interactions
- Disadvantages: Computationally expensive, overfitting risk

3. Embedded Methods:
- L1 Regularization (Lasso): Drives coefficients to zero
- Tree Feature Importance: From Random Forest, XGBoost
- Permutation Importance: Shuffle feature, measure impact
- SHAP Values: Game-theoretic feature attribution
- Advantages: Fast, integrated with training
- Disadvantages: Model-specific

4. Dimensionality Reduction:
- PCA: Linear projection to uncorrelated components
- t-SNE, UMAP: Non-linear visualization
- LDA: Supervised dimensionality reduction
- Autoencoders: Neural network-based
- Feature hashing: Random projection

Data Augmentation:

1. For Images:
- Geometric: Rotation, flip, crop, zoom, shear
- Color: Brightness, contrast, saturation, hue
- Noise: Gaussian, salt-and-pepper
- Advanced: Mixup, CutMix, AutoAugment

2. For Text:
- Synonym replacement
- Back-translation
- Random insertion/deletion/swap
- Paraphrasing with language models

3. For Tabular Data:
- SMOTE: Synthetic Minority Over-sampling
- ADASYN: Adaptive synthetic sampling
- Mixup: Convex combinations of examples
- Noise injection

4. For Time Series:
- Window slicing
- Time warping
- Magnitude warping
- Jittering

Handling Imbalanced Data:

1. Resampling:
- Oversampling: Duplicate minority class
- Undersampling: Remove majority class
- SMOTE: Generate synthetic minority examples
- ADASYN: Adaptive synthetic sampling
- Combination: Over+under sampling

2. Algorithmic Approaches:
- Class Weights: Penalize misclassification differently
- Cost-Sensitive Learning: Different costs for errors
- Threshold Moving: Adjust classification threshold
- Ensemble Methods: Balanced bagging, EasyEnsemble

3. Evaluation Considerations:
- Don't use accuracy alone
- Use precision, recall, F1, AUC-ROC
- Consider business metrics (cost of false positives vs negatives)

Feature Engineering Best Practices:

1. Iterative Process:
- Start simple, add complexity gradually
- Measure impact of each feature
- Keep track of what works
- Document feature definitions

2. Avoid Data Leakage:
- Use only information available at prediction time
- Split data before any preprocessing
- Fit transformations only on training data
- Be careful with time series (no future information)
- Watch for target leakage (features derived from target)

3. Validation Strategy:
- Use cross-validation to test feature impact
- Hold-out test set for final evaluation
- Time-based splits for temporal data
- Stratified splits for imbalanced data

4. Feature Engineering Pipeline:
- Create reproducible pipelines
- Use sklearn Pipeline or custom classes
- Save preprocessing objects
- Version control feature engineering code
- Document feature logic and assumptions

5. Computational Efficiency:
- Cache computed features
- Parallelize when possible
- Use sparse matrices for one-hot encoding
- Optimize for inference speed
- Consider memory constraints

6. Model-Specific Considerations:
- Tree-based: Less feature scaling needed, can handle missing values
- Linear models: Require scaling, sensitive to outliers
- Neural networks: Require normalization, benefit from feature engineering
- Distance-based: Require scaling, sensitive to irrelevant features

Advanced Techniques:

1. Automated Feature Engineering:
- Featuretools: Automated deep feature synthesis
- tsfresh: Time series feature extraction
- AutoFeat: Automated feature engineering and selection

2. Feature Learning:
- Deep learning: Learn features automatically
- Representation learning: Embeddings for categorical variables
- Transfer learning: Use pre-trained features

3. Feature Interaction Detection:
- Decision trees: Naturally capture interactions
- ANOVA tests: Statistical interaction testing
- Exhaustive search: Try all pairwise interactions
- Genetic algorithms: Evolutionary feature creation

Tools and Libraries:
- Pandas: Data manipulation
- NumPy: Numerical operations
- Scikit-learn: Preprocessing, feature selection
- Featuretools: Automated feature engineering
- Category Encoders: Categorical encoding methods
- Imbalanced-learn: Handling imbalanced data
- Yellowbrick: Visualization
- SHAP: Feature importance and explanation

Common Mistakes to Avoid:
- Data leakage from target variable
- Not scaling features for distance-based models
- Removing features without testing
- Over-engineering features (diminishing returns)
- Not handling missing values properly
- Ignoring domain knowledge
- Not validating on unseen data
- Creating features from test data
- Forgetting to encode categorical variables
- Not documenting feature engineering process

Real-World Considerations:
- Production deployment: Keep features simple and fast
- Data drift: Monitor feature distributions over time
- Missing data in production: Handle gracefully
- Feature maintenance: Update as business changes
- Explainability: Simpler features easier to explain
- Regulatory compliance: Avoid protected attributes
- Fairness: Check for demographic bias in features`,
    metadata: { topic: 'feature_engineering', category: 'preprocessing', difficulty: 'intermediate' }
  },
  {
    id: 10,
    content: `Model Evaluation and Validation:

Overview:
Proper evaluation ensures models generalize well to unseen data and meet business objectives. It's crucial for understanding model performance, comparing approaches, and making informed deployment decisions.

Train-Test Split Strategies:

1. Hold-Out Validation:
- Split: Typically 70-30 or 80-20 (train-test)
- When to use: Large datasets, quick evaluation needed
- Pros: Simple, fast, computationally efficient
- Cons: Performance varies with random split, uses less training data
- Best practice: Stratify for classification, random seed for reproducibility

2. Cross-Validation (CV):
- K-Fold CV: Split data into K folds, train on K-1, test on 1, rotate
  - Typical K values: 5 or 10
  - Each sample used for testing exactly once
  - Final metric: Average across K folds
- Stratified K-Fold: Maintains class distribution in each fold
  - Essential for imbalanced datasets
  - Ensures each fold is representative
- Leave-One-Out CV (LOOCV): K = n (number of samples)
  - Maximum use of training data
  - Computationally expensive
  - High variance in estimates
- Time Series CV: Forward chaining / Expanding window
  - Respects temporal order
  - No future data leaks into past
  - Types: Rolling window, expanding window
- Pros: Robust estimate, uses all data for training and testing
- Cons: Computationally expensive (K times slower)
- When to use: Small to medium datasets, hyperparameter tuning

3. Validation Set Approach:
- Split: Train (60%), Validation (20%), Test (20%)
- Validation: For hyperparameter tuning and model selection
- Test: Final evaluation, untouched until the end
- Critical: Never use test set for any training decisions
- Best practice: Treat test set as production data

Classification Metrics:

1. Confusion Matrix:
- True Positives (TP): Correctly predicted positive
- True Negatives (TN): Correctly predicted negative
- False Positives (FP): Incorrectly predicted positive (Type I error)
- False Negatives (FN): Incorrectly predicted negative (Type II error)
- Visual representation of all prediction outcomes
- Foundation for other metrics

2. Accuracy:
- Formula: (TP + TN) / (TP + TN + FP + FN)
- Range: [0, 1], higher is better
- When to use: Balanced datasets, equal cost of errors
- Pitfall: Misleading for imbalanced datasets
- Example: 95% accuracy with 95% majority class is meaningless

3. Precision:
- Formula: TP / (TP + FP)
- Interpretation: Of predicted positives, how many are correct?
- When to prioritize: When false positives are costly
- Examples: Spam detection (don't mark good emails as spam), medical tests (don't alarm healthy patients)

4. Recall (Sensitivity, True Positive Rate):
- Formula: TP / (TP + FN)
- Interpretation: Of actual positives, how many did we find?
- When to prioritize: When false negatives are costly
- Examples: Disease screening (don't miss sick patients), fraud detection (don't miss fraud cases)

5. F1-Score:
- Formula: 2 * (Precision * Recall) / (Precision + Recall)
- Harmonic mean of precision and recall
- Range: [0, 1], higher is better
- When to use: Need balance between precision and recall, imbalanced datasets
- Variants: F-beta score weights precision/recall differently

6. Specificity (True Negative Rate):
- Formula: TN / (TN + FP)
- Interpretation: Of actual negatives, how many correctly identified?
- Important in medical testing, anomaly detection

7. ROC Curve (Receiver Operating Characteristic):
- Plots True Positive Rate vs False Positive Rate at various thresholds
- Shows trade-off between sensitivity and specificity
- AUC-ROC (Area Under Curve):
  - Range: [0, 1], higher is better
  - 0.5: Random classifier
  - 0.7-0.8: Acceptable
  - 0.8-0.9: Excellent
  - >0.9: Outstanding
- Threshold independent
- Good for comparing models
- When to use: Probability-based models, comparing across thresholds

8. Precision-Recall Curve:
- Plots Precision vs Recall at various thresholds
- AP (Average Precision): Area under PR curve
- Better than ROC for imbalanced datasets
- When to use: Rare positive class, imbalanced data

9. Matthews Correlation Coefficient (MCC):
- Formula: (TP*TN - FP*FN) / sqrt((TP+FP)(TP+FN)(TN+FP)(TN+FN))
- Range: [-1, 1], 0 is random, 1 is perfect
- Balanced measure even for imbalanced classes
- Takes all confusion matrix values into account

10. Log Loss (Cross-Entropy):
- Measures probability estimate quality
- Formula: -1/n * Σ [y*log(p) + (1-y)*log(1-p)]
- Range: [0, ∞], lower is better
- Penalizes confident wrong predictions heavily
- When to use: Need calibrated probabilities

Regression Metrics:

1. Mean Absolute Error (MAE):
- Formula: (1/n) * Σ |y_true - y_pred|
- Interpretation: Average absolute difference
- Units: Same as target variable
- Robust to outliers
- Easy to interpret

2. Mean Squared Error (MSE):
- Formula: (1/n) * Σ (y_true - y_pred)²
- Penalizes large errors more than small ones
- Not robust to outliers
- Units: Squared target units (hard to interpret)

3. Root Mean Squared Error (RMSE):
- Formula: sqrt(MSE)
- Same units as target variable
- More interpretable than MSE
- Standard choice for many regression problems

4. R² Score (Coefficient of Determination):
- Formula: 1 - (SS_res / SS_tot)
- Range: (-∞, 1], 1 is perfect, 0 means predicting mean, <0 means worse than mean
- Interpretation: Proportion of variance explained
- Adjusted R²: Penalizes for number of features
- When to use: Compare models, assess goodness of fit

5. Mean Absolute Percentage Error (MAPE):
- Formula: (100/n) * Σ |(y_true - y_pred) / y_true|
- Interpretation: Percentage error
- Easy to understand (percentage terms)
- Problem: Undefined when y_true = 0, biased toward low predictions

6. Median Absolute Error:
- Median of absolute errors
- Very robust to outliers
- When to use: Presence of outliers, need robust metric

7. Huber Loss:
- Combines MSE (for small errors) and MAE (for large errors)
- Robust to outliers while maintaining smoothness
- Hyperparameter δ controls transition

Model Selection and Hyperparameter Tuning:

1. Grid Search:
- Exhaustively tries all parameter combinations
- Pros: Guaranteed to find best in grid
- Cons: Exponentially grows with parameters, inefficient
- When to use: Small parameter space, computational resources available
- Implementation: GridSearchCV in sklearn

2. Random Search:
- Randomly samples from parameter distributions
- Pros: More efficient, better for continuous parameters
- Cons: Might miss optimal combination
- Often finds good solution with fraction of computations
- Implementation: RandomizedSearchCV in sklearn

3. Bayesian Optimization:
- Uses probabilistic model to guide search
- Balances exploration and exploitation
- More efficient than grid/random search
- Libraries: Optuna, Hyperopt, scikit-optimize
- When to use: Expensive model training, many hyperparameters

4. Hyperband / ASHA:
- Early stopping for poorly performing configurations
- Allocates more resources to promising configurations
- Very efficient for deep learning
- Implementation: Ray Tune, Optuna

5. Nested Cross-Validation:
- Outer CV: Estimate generalization error
- Inner CV: Hyperparameter tuning
- Unbiased performance estimate
- Computationally expensive
- When to use: Small datasets, need unbiased estimate

Overfitting and Underfitting:

1. Detection:
- Learning Curves: Plot train vs validation error
  - Overfitting: Large gap between train and validation
  - Underfitting: Both errors high, converge quickly
  - Good fit: Small gap, both errors low
- Validation Curves: Performance vs hyperparameter value
- Monitor train and validation metrics during training

2. Preventing Overfitting:
- More training data
- Regularization (L1, L2, dropout, early stopping)
- Simpler model (fewer parameters, shallower trees)
- Feature selection (remove irrelevant features)
- Cross-validation
- Ensemble methods
- Data augmentation

3. Addressing Underfitting:
- More complex model (deeper, more parameters)
- Better features (feature engineering)
- Remove regularization or reduce its strength
- Train longer
- Different algorithm

Bias-Variance Tradeoff:

- Bias: Error from wrong assumptions, leads to underfitting
- Variance: Error from sensitivity to training data, leads to overfitting
- Total Error = Bias² + Variance + Irreducible Error
- Goal: Find sweet spot minimizing both
- Simple models: High bias, low variance
- Complex models: Low bias, high variance

Model Comparison:

1. Statistical Tests:
- Paired t-test: Compare two models on same folds
- McNemar's test: For classification on same test set
- Friedman test: Compare multiple models
- Wilcoxon signed-rank test: Non-parametric alternative
- Significance level: Typically α = 0.05

2. Confidence Intervals:
- Bootstrap resampling for metric confidence intervals
- Helps assess reliability of performance estimates
- Wider intervals indicate more uncertainty

3. Cross-Model Analysis:
- Error analysis: Where does each model fail?
- Complementary strengths: Potential for ensembling
- Correlation of predictions: Low correlation good for ensembles

Practical Validation Considerations:

1. Data Leakage Prevention:
- Fit all preprocessing on training data only
- No information from validation/test in training
- Time-based splits for temporal data
- Careful with feature engineering
- Watch for subtle leakage (IDs, timestamps)

2. Stratification:
- Maintain class distribution across splits
- Essential for imbalanced classification
- Also consider for regression (bin targets)
- Group-aware splits (keep related samples together)

3. Temporal Validation:
- For time series: Always validate on future data
- Walk-forward validation
- Consider seasonality and trends
- Test on different time periods

4. Production Validation:
- A/B testing in production
- Shadow mode (run alongside existing system)
- Monitor business metrics, not just ML metrics
- Gradual rollout (canary deployment)
- Feedback loops and continuous monitoring

Domain-Specific Considerations:

1. Imbalanced Data:
- Don't rely on accuracy
- Use precision, recall, F1, AUC
- Stratified sampling
- Consider business costs of errors
- Appropriate resampling if needed

2. Multi-Class:
- Macro-averaging: Equal weight to each class
- Micro-averaging: Equal weight to each sample
- Weighted averaging: By class frequency
- Per-class metrics
- Confusion matrix analysis

3. Multi-Label:
- Hamming loss: Fraction of wrong labels
- Subset accuracy: All labels correct
- Label-based metrics: Average across labels
- Example-based metrics: Average across examples

4. Ranking/Recommendation:
- Precision@K: Precision in top K results
- Recall@K: Recall in top K results
- Mean Average Precision (MAP)
- Normalized Discounted Cumulative Gain (NDCG)
- Mean Reciprocal Rank (MRR)

5. Clustering:
- Silhouette score
- Davies-Bouldin index
- Calinski-Harabasz index
- External: Adjusted Rand Index, Normalized Mutual Information (if ground truth available)

Model Interpretation and Explainability:

1. Feature Importance:
- Tree-based: Built-in feature importance
- Permutation importance: Shuffle and measure impact
- Drop-column importance: Remove and retrain
- Pros: Understand model decisions
- Cons: Can be misleading, correlations

2. SHAP (SHapley Additive exPlanations):
- Game-theoretic approach
- Local and global explanations
- Shows contribution of each feature to prediction
- Handles feature interactions
- Works for any model
- Computationally expensive

3. LIME (Local Interpretable Model-agnostic Explanations):
- Explains individual predictions
- Fits local surrogate model
- Fast, intuitive
- May be unstable

4. Partial Dependence Plots:
- Show relationship between feature and prediction
- Marginalizes over other features
- Global model behavior
- Can show feature interactions (2D plots)

5. Individual Conditional Expectation (ICE):
- Per-sample partial dependence
- Shows heterogeneity in relationships
- Complements partial dependence plots

Business Metrics vs ML Metrics:

- ML metrics (accuracy, RMSE): Technical performance
- Business metrics (revenue, cost savings, customer satisfaction): Real-world impact
- Always connect ML metrics to business outcomes
- Examples:
  - Classification: False positive cost vs false negative cost
  - Ranking: Click-through rate, conversion rate
  - Recommendation: User engagement, revenue per user
  - Churn: Customer lifetime value saved
- Optimize for business objectives, not just ML metrics

Common Pitfalls:

- Using same data for training and evaluation
- Not using cross-validation for small datasets
- Ignoring class imbalance
- Cherry-picking best results without proper validation
- Not testing on truly unseen data
- Overfitting to validation set through excessive tuning
- Ignoring confidence intervals
- Not considering computational cost in production
- Focusing solely on accuracy
- Not performing error analysis
- Neglecting model monitoring in production

Best Practices:

1. Always have a held-out test set
2. Use cross-validation for robust estimates
3. Choose metrics aligned with business goals
4. Analyze errors to understand failures
5. Compare against simple baselines
6. Document evaluation methodology
7. Report confidence intervals
8. Test on diverse, representative data
9. Monitor performance in production
10. Iterate based on feedback

Tools and Libraries:
- Scikit-learn: Metrics, cross-validation, model selection
- Yellowbrick: Visualization
- MLflow: Experiment tracking
- Weights & Biases: Monitoring, tracking
- TensorBoard: Deep learning metrics
- SHAP, LIME: Model interpretation
- Evidently AI: Production monitoring`,
    metadata: { topic: 'model_evaluation', category: 'evaluation', difficulty: 'advanced' }
  }
];

async function setupMLCollection() {
  const client = new QdrantClient({ url: 'http://localhost:6333' });

  try {
    console.log('[ragify] 🚀 Starting Enhanced ML Knowledge Collection Setup...\n');

    // Check if collection exists, delete if it does
    try {
      await client.getCollection(COLLECTION_NAME);
      console.log('[ragify] 🗑️  Deleting existing collection...');
      await client.deleteCollection(COLLECTION_NAME);
    } catch (err) {
      console.log('[ragify] ℹ️  No existing collection found');
    }

    // Create collection with OpenAI embedding dimensions (1536 for text-embedding-ada-002)
    console.log('[ragify] 📦 Creating new collection...');
    await client.createCollection(COLLECTION_NAME, {
      vectors: {
        size: 1536,
        distance: 'Cosine'
      }
    });
    console.log('[ragify] ✅ Collection created successfully\n');

    // Generate embeddings and insert documents
    console.log('[ragify] 🔄 Processing and inserting documents...\n');
    
    for (const doc of mlDocuments) {
      console.log(`[ragify] Processing: ${doc.metadata.topic} (${doc.metadata.difficulty})...`);
      
      // Generate embedding for the content
      const embedding = await getEmbedding(doc.content);
      
      // Insert point into collection
      await client.upsert(COLLECTION_NAME, {
        points: [
          {
            id: doc.id,
            vector: embedding,
            payload: {
              content: doc.content,
              ...doc.metadata
            }
          }
        ]
      });
      
      console.log(`[ragify] ✅ Inserted: ${doc.metadata.topic} | Category: ${doc.metadata.category} | Difficulty: ${doc.metadata.difficulty}`);
    }

    console.log('\n[ragify] 🎉 Enhanced ML Knowledge Collection setup complete!');
    console.log(`[ragify] 📊 Total documents: ${mlDocuments.length}`);
    console.log('[ragify] 📚 Topics covered:');
    console.log('  - Introduction to ML');
    console.log('  - Advantages and Disadvantages');
    console.log('  - Supervised Learning (Linear Regression, Decision Trees, Random Forest, SVM, KNN, Naive Bayes, Neural Networks)');
    console.log('  - Unsupervised Learning (K-Means, Hierarchical, DBSCAN, PCA, t-SNE, Autoencoders, GMM, Apriori, Isolation Forest, SOM)');
    console.log('  - Reinforcement Learning (Q-Learning, DQN, SARSA, Policy Gradient, Actor-Critic, PPO, Monte Carlo, TD Learning)');
    console.log('  - Deep Learning (CNNs, RNNs, LSTMs, Transformers, GANs, Autoencoders, ResNet, U-Net)');
    console.log('  - Ensemble Methods (Bagging, Boosting, AdaBoost, Gradient Boosting, XGBoost, LightGBM, CatBoost, Stacking, Voting)');
    console.log('  - Feature Engineering and Preprocessing');
    console.log('  - Model Evaluation and Validation');
    
    // Verify collection info
    const collectionInfo = await client.getCollection(COLLECTION_NAME);
    console.log(`\n[ragify] 📈 Collection status:`, {
      name: collectionInfo.name,
      vectorsCount: collectionInfo.vectors_count,
      pointsCount: collectionInfo.points_count,
      status: collectionInfo.status
    });

  } catch (error) {
    console.error('[ragify] ❌ Error setting up collection:', error);
    throw error;
  }
}

// Run the setup
setupMLCollection()
  .then(() => {
    console.log('\n[ragify] ✨ Setup completed successfully! Ready to query ML knowledge.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n[ragify] 💥 Setup failed:', error.message);
    process.exit(1);
  });