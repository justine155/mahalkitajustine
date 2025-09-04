import React, { useState, useMemo, useEffect } from 'react';
import { Search, Filter, Edit, Trash2, X, Settings } from 'lucide-react';
import { FixedCommitment, Commitment } from '../types';

interface CommitmentsListProps {
  commitments: FixedCommitment[];
  onEditCommitment: (commitment: FixedCommitment) => void;
  onDeleteCommitment: (commitmentId: string) => void;
}

const CATEGORIES = [
  'All',
  'Academics',
  'Work',
  'Personal',
  'Health',
  'Learning',
  'Finance',
  'Home',
  'Organization',
  'Routine',
  'Buffer',
];

const getCategoryColor = (category: string) => {
  switch (category) {
    case 'Academics':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
    case 'Work':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300';
    case 'Personal':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
    case 'Health':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
    case 'Learning':
      return 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-300';
    case 'Finance':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
    case 'Home':
      return 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300';
    case 'Organization':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
    case 'Buffer':
      return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300';
    case 'Routine':
      return 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
  }
};

const CommitmentsList: React.FC<CommitmentsListProps> = ({
  commitments,
  onEditCommitment,
  onDeleteCommitment,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(() => {
    return localStorage.getItem('timepilot-commitments-filter-category') || 'All';
  });
  const [showFilters, setShowFilters] = useState(false);

  // Persist category filter selection
  useEffect(() => {
    localStorage.setItem('timepilot-commitments-filter-category', selectedCategory);
  }, [selectedCategory]);

  // Filter and search commitments
  const filteredCommitments = useMemo(() => {
    return commitments.filter((commitment) => {
      // Category filter
      const categoryMatch = selectedCategory === 'All' || commitment.category === selectedCategory;
      
      // Search filter (case-insensitive search in title, location, and description)
      const searchMatch = !searchTerm || 
        commitment.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        commitment.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        commitment.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      return categoryMatch && searchMatch;
    });
  }, [commitments, selectedCategory, searchTerm]);

  // Get unique categories from existing commitments
  const availableCategories = useMemo(() => {
    const existingCategories = [...new Set(commitments.map(c => c.category))];
    return CATEGORIES.filter(category => 
      category === 'All' || existingCategories.includes(category)
    );
  }, [commitments]);

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedCategory('All');
  };

  const hasActiveFilters = searchTerm || selectedCategory !== 'All';

  return (
    <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 dark:bg-gray-900 dark:shadow-gray-900">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-white">
          Your Commitments
          {filteredCommitments.length !== commitments.length && (
            <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
              ({filteredCommitments.length} of {commitments.length})
            </span>
          )}
        </h2>

        <div className="flex items-center space-x-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search commitments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white dark:focus:ring-blue-400 w-48"
            />
          </div>

          {/* Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg border transition-colors text-sm font-medium ${
              showFilters || selectedCategory !== 'All'
                ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
            title="Filter commitments"
          >
            <Filter size={18} />
          </button>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300 transition-colors"
              title="Clear all filters"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Category Filter */}
      {showFilters && (
        <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
            Filter by Category
          </label>
          <div className="flex flex-wrap gap-2">
            {availableCategories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  selectedCategory === category
                    ? 'bg-blue-500 text-white'
                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {category}
                {category !== 'All' && (
                  <span className="ml-1 opacity-75">
                    ({commitments.filter(c => c.category === category).length})
                  </span>
                )}
                {category === 'All' && (
                  <span className="ml-1 opacity-75">({commitments.length})</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Commitments List */}
      <div className="space-y-3">
        {filteredCommitments.length === 0 ? (
          <div className="text-center py-8">
            {commitments.length === 0 ? (
              <div>
                <div className="text-4xl mb-4">📅</div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">
                  No Commitments Yet
                </h3>
                <p className="text-gray-500 dark:text-gray-400">
                  Add your class schedule, work hours, and other fixed commitments above.
                </p>
              </div>
            ) : (
              <div>
                <div className="text-4xl mb-4">🔍</div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">
                  No Matching Commitments
                </h3>
                <p className="text-gray-500 dark:text-gray-400">
                  Try adjusting your search terms or category filter.
                </p>
                <button
                  onClick={clearFilters}
                  className="mt-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        ) : (
          filteredCommitments.map((commitment) => (
            <div
              key={commitment.id}
              className="p-4 sm:p-6 border border-gray-200 rounded-xl bg-white hover:shadow-md transition-all duration-200 dark:bg-gray-800 dark:border-gray-700"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="flex items-center space-x-2">
                      <Settings className="text-gray-500" size={18} title="Fixed Commitment" />
                      <h3 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-white truncate">
                        {commitment.title}
                      </h3>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0">
                      <span
                        className={`px-2 sm:px-3 py-1 text-xs font-medium rounded-full ${getCategoryColor(
                          commitment.category
                        )}`}
                      >
                        {commitment.category}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                        {commitment.isAllDay ? (
                          <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                            <span className="font-medium">⏰</span>
                            <span>All Day</span>
                          </div>
                        ) : commitment.useDaySpecificTiming && commitment.daySpecificTimings && commitment.daySpecificTimings.length > 0 ? (
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                              <span className="font-medium">⏰</span>
                              <span className="font-medium">Day-specific timing:</span>
                            </div>
                            <div className="ml-6 space-y-1">
                              {commitment.daySpecificTimings.map((timing, index) => {
                                const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][timing.dayOfWeek];
                                return (
                                  <div key={index} className="text-xs text-gray-500 dark:text-gray-400">
                                    <span className="font-medium">{dayName}:</span>{' '}
                                    {timing.isAllDay ? 'All Day' : `${timing.startTime} - ${timing.endTime}`}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                            <span className="font-medium">⏰</span>
                            <span>
                              {commitment.startTime && commitment.endTime
                                ? `${commitment.startTime} - ${commitment.endTime}`
                                : 'No time specified'
                              }
                            </span>
                          </div>
                        )}
                        <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                          <span className="font-medium">📅</span>
                          <span className="truncate">
                            {commitment.recurring
                              ? commitment.daysOfWeek
                                  .map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day])
                                  .join(', ')
                              : commitment.specificDates
                                  ?.map((date) => new Date(date).toLocaleDateString())
                                  .join(', ')}
                          </span>
                        </div>
                    {commitment.location && (
                      <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                        <span className="font-medium">📍</span>
                        <span className="truncate">{commitment.location}</span>
                      </div>
                    )}
                    {commitment.description && (
                      <div className="flex items-start space-x-2 text-sm text-gray-600 dark:text-gray-300">
                        <span className="font-medium mt-0.5">📝</span>
                        <span className="flex-1">{commitment.description}</span>
                      </div>
                    )}
                    {commitment.dateRange?.startDate && commitment.dateRange?.endDate && (
                      <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                        <span className="font-medium">📊</span>
                        <span className="truncate">
                          {new Date(commitment.dateRange.startDate).toLocaleDateString()} -{' '}
                          {new Date(commitment.dateRange.endDate).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2 ml-4 flex-shrink-0">
                      <button
                        onClick={() => onEditCommitment(commitment)}
                        className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700"
                        title="Edit commitment"
                      >
                        <Edit size={20} />
                      </button>
                      <button
                        onClick={() => onDeleteCommitment(commitment.id)}
                        className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 rounded-lg transition-colors dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900"
                        title="Delete commitment"
                      >
                        <Trash2 size={20} />
                      </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CommitmentsList;
